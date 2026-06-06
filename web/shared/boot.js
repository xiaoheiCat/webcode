(function (global) {
  "use strict";

  var SW_URL = "/sw.js";
  var SW_VERSION = "webcode-v2-emscripten";

  function swSupported() {
    return "serviceWorker" in navigator;
  }

  function registerServiceWorker() {
    if (!swSupported()) {
      return Promise.resolve(null);
    }
    return navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(function (err) {
      console.warn("Service worker registration failed:", err);
      return null;
    });
  }

  function waitForServiceWorker(reg) {
    if (!reg) return Promise.resolve(null);
    if (reg.active) return Promise.resolve(reg.active);
    return new Promise(function (resolve) {
      var worker = reg.installing || reg.waiting;
      if (!worker) {
        resolve(null);
        return;
      }
      worker.addEventListener("statechange", function () {
        if (worker.state === "activated") resolve(reg.active);
      });
    });
  }

  function flushCaches(scope) {
    if (!swSupported()) {
      return Promise.resolve();
    }
    return navigator.serviceWorker.ready.then(function (reg) {
      if (!reg.active) return;
      return new Promise(function (resolve) {
        var channel = new MessageChannel();
        channel.port1.onmessage = function () { resolve(); };
        reg.active.postMessage({ type: "FLUSH", scope: scope || "all" }, [channel.port2]);
      });
    });
  }

  var vmUnloadGuardEnabled = false;

  function onBeforeUnload(e) {
    if (!vmUnloadGuardEnabled) return;
    e.preventDefault();
    e.returnValue = "";
    return "";
  }

  function enableVmUnloadGuard() {
    if (vmUnloadGuardEnabled) return;
    vmUnloadGuardEnabled = true;
    window.addEventListener("beforeunload", onBeforeUnload);
  }

  function disableVmUnloadGuard() {
    if (!vmUnloadGuardEnabled) return;
    vmUnloadGuardEnabled = false;
    window.removeEventListener("beforeunload", onBeforeUnload);
  }

  function preloadOneAsset(url, state, report) {
    return fetch(url, { credentials: "same-origin" }).then(function (resp) {
      if (!resp.ok) {
        throw new Error("Failed to fetch " + url + ": " + resp.status);
      }

      var contentLength = Number(resp.headers.get("Content-Length")) || 0;
      if (contentLength > 0) {
        state.total = contentLength;
      }

      if (!resp.body) {
        return resp.arrayBuffer().then(function (buf) {
          state.loaded = buf.byteLength;
          if (!state.total) {
            state.total = buf.byteLength;
          }
          state.done = true;
          report();
        });
      }

      var reader = resp.body.getReader();

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            if (!state.total) {
              state.total = state.loaded;
            }
            state.done = true;
            report();
            return;
          }
          state.loaded += result.value.length;
          report();
          return pump();
        });
      }

      report();
      return pump();
    });
  }

  function preloadAssets(base, assets, onProgress) {
    var states = assets.map(function () {
      return { loaded: 0, total: 0, done: false };
    });

    function report() {
      var loaded = 0;
      var total = 0;
      var pendingUnknown = 0;

      for (var i = 0; i < states.length; i++) {
        loaded += states[i].loaded;
        if (states[i].total > 0) {
          total += states[i].total;
        } else if (!states[i].done) {
          pendingUnknown++;
        } else {
          total += states[i].loaded;
        }
      }

      if (total > 0) {
        onProgress(Math.min(1, loaded / total));
      } else if (pendingUnknown === 0 && states.length > 0) {
        onProgress(1);
      }
    }

    return Promise.all(assets.map(function (asset, idx) {
      var url = new URL(asset, base).href;
      return preloadOneAsset(url, states[idx], report);
    }));
  }

  function start(opts) {
    var workspacePromise = opts.skipWorkspace
      ? Promise.resolve({ mode: "memory" })
      : WebCodeWorkspace.pickWorkspace(opts.productName).then(function (workspace) {
          if (workspace.mode === "host") {
            return WebCodeWorkspace.createHostFsWorker(workspace.handle).then(function (fs) {
              workspace.fsWorker = fs.worker;
              workspace.fsShared = fs.shared;
              return workspace;
            });
          }
          return workspace;
        });

    return workspacePromise
      .then(function (workspace) {
        var progress = Win95.showProgressDialog(
          opts.productName || "Web Code",
          "正在准备 Web Code 虚拟机..."
        );
        return registerServiceWorker()
          .then(waitForServiceWorker)
          .then(function () {
            return preloadAssets(opts.base, opts.assets, function (pct) {
              progress.setProgress(pct * 100);
            });
          })
          .then(function () {
            progress.setProgress(100);
            progress.close();
            return opts.init(workspace);
          })
          .catch(function (err) {
            progress.close();
            if (workspace.fsWorker) {
              workspace.fsWorker.terminate();
            }
            Win95.showConfirmDialog({
              title: "错误",
              message: "资源加载失败：" + (err.message || err) + "\n请检查网络后重试。",
              yesLabel: "重试",
              noLabel: "返回",
            }).then(function (ok) {
              disableVmUnloadGuard();
              if (ok) location.reload();
              else location.href = "/";
            });
            throw err;
          });
      })
      .catch(function (err) {
        if (err && err.message === "cancelled") {
          disableVmUnloadGuard();
          location.href = "/";
        }
        throw err;
      });
  }

  function flushPage(opts) {
    document.body.classList.add("win95-body");
    Win95.showConfirmDialog({
      title: "重置镜像",
      message:
        "你确定要重置虚拟机的镜像吗？\n" +
        "下次将从头开始重新载入镜像。\n" +
        "推荐在遇到问题或者需要更新镜像时使用。",
      yesLabel: "是 (Y)",
      noLabel: "否 (N)",
    }).then(function (ok) {
      if (ok) {
        var loading = Win95.showProgressDialog("重置镜像", "正在清除缓存...");
        flushCaches(opts.scope).then(function () {
          loading.setProgress(100);
          loading.close();
          disableVmUnloadGuard();
          location.href = opts.redirect || "/";
        });
      } else {
        disableVmUnloadGuard();
        location.href = opts.redirect || "/";
      }
    });
  }

  global.WebCodeBoot = {
    SW_VERSION: SW_VERSION,
    registerServiceWorker: registerServiceWorker,
    flushCaches: flushCaches,
    preloadAssets: preloadAssets,
    enableVmUnloadGuard: enableVmUnloadGuard,
    disableVmUnloadGuard: disableVmUnloadGuard,
    start: start,
    flushPage: flushPage,
  };
})(window);
