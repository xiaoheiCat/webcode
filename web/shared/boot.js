(function (global) {
  "use strict";

  var SW_URL = "/sw.js";
  var SW_VERSION = "webcode-v1";

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

  function fetchWithProgress(url, onItemProgress) {
    return fetch(url, { credentials: "same-origin" }).then(function (resp) {
      if (!resp.ok) {
        throw new Error("Failed to fetch " + url + ": " + resp.status);
      }
      var total = Number(resp.headers.get("Content-Length")) || 0;
      if (!resp.body || !total) {
        return resp.arrayBuffer().then(function (buf) {
          onItemProgress(1);
          return buf;
        });
      }
      var reader = resp.body.getReader();
      var received = 0;
      var chunks = [];

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            onItemProgress(1);
            var out = new Uint8Array(received);
            var offset = 0;
            for (var i = 0; i < chunks.length; i++) {
              out.set(chunks[i], offset);
              offset += chunks[i].length;
            }
            return out.buffer;
          }
          chunks.push(result.value);
          received += result.value.length;
          onItemProgress(received / total);
          return pump();
        });
      }
      return pump();
    });
  }

  function preloadAssets(base, assets, onProgress) {
    var sizes = assets.map(function () { return 0; });
    var weights = assets.map(function (a) {
      return /\.wasm$/i.test(a) ? 10 : 1;
    });
    var totalWeight = weights.reduce(function (s, w) { return s + w; }, 0);

    function report() {
      var loaded = 0;
      for (var i = 0; i < assets.length; i++) {
        loaded += weights[i] * sizes[i];
      }
      onProgress(loaded / totalWeight);
    }

    var chain = Promise.resolve();
    assets.forEach(function (asset, idx) {
      chain = chain.then(function () {
        var url = new URL(asset, base).href;
        return fetchWithProgress(url, function (frac) {
          sizes[idx] = frac;
          report();
        });
      });
    });
    return chain;
  }

  function start(opts) {
    return WebCodeWorkspace.pickWorkspace(opts.productName)
      .then(function (workspace) {
        if (workspace.mode === "host") {
          return WebCodeWorkspace.createHostFsWorker(workspace.handle).then(function (fs) {
            workspace.fsWorker = fs.worker;
            workspace.fsShared = fs.shared;
            return workspace;
          });
        }
        return workspace;
      })
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
              if (ok) location.reload();
              else location.href = "/";
            });
            throw err;
          });
      })
      .catch(function (err) {
        if (err && err.message === "cancelled") {
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
          location.href = opts.redirect || "/";
        });
      } else {
        location.href = opts.redirect || "/";
      }
    });
  }

  global.WebCodeBoot = {
    SW_VERSION: SW_VERSION,
    registerServiceWorker: registerServiceWorker,
    flushCaches: flushCaches,
    preloadAssets: preloadAssets,
    start: start,
    flushPage: flushPage,
  };
})(window);
