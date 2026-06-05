(function (global) {
  "use strict";

  function hostFsSupported() {
    return typeof window.showDirectoryPicker === "function";
  }

  function pickWorkspace(productName) {
    return Win95.showChoiceDialog({
      title: "选择工作区",
      message: productName + " 的工作区应该来自哪里？",
      choices: [
        { label: "临时工作区...", value: "memory" },
        { label: "此设备的文件夹...", value: "host" },
      ],
    }).then(function (choice) {
      if (!choice) {
        return Promise.reject(new Error("cancelled"));
      }
      if (choice === "memory") {
        return Win95.showConfirmDialog({
          title: "警告",
          message:
            "临时工作区会将这个对话期间产生的所有数据置于内存。\n" +
            "如果你在关闭前没有将其推送到 Git，那么他们将会永久消失。\n\n" +
            "继续吗？",
          yesLabel: "继续",
          noLabel: "返回",
        }).then(function (ok) {
          if (!ok) return pickWorkspace(productName);
          return { mode: "memory" };
        });
      }
      if (!hostFsSupported()) {
        return Win95.showConfirmDialog({
          title: "不支持",
          message:
            "当前浏览器不支持选择本地文件夹。\n" +
            "请使用 Chrome 桌面版，或改用临时工作区。",
          yesLabel: "临时工作区",
          noLabel: "返回",
        }).then(function (ok) {
          if (!ok) return pickWorkspace(productName);
          return Win95.showConfirmDialog({
            title: "警告",
            message:
              "临时工作区会将这个对话期间产生的所有数据置于内存。\n" +
              "如果你在关闭前没有将其推送到 Git，那么他们将会永久消失。\n\n" +
              "继续吗？",
            yesLabel: "继续",
            noLabel: "返回",
          }).then(function (ok2) {
            if (!ok2) return pickWorkspace(productName);
            return { mode: "memory" };
          });
        });
      }
      return window.showDirectoryPicker({ mode: "readwrite" }).then(function (handle) {
        return { mode: "host", handle: handle };
      }).catch(function (err) {
        if (err && err.name === "AbortError") {
          return pickWorkspace(productName);
        }
        throw err;
      });
    });
  }

  function createHostFsWorker(handle) {
    return new Promise(function (resolve, reject) {
      var shared = new SharedArrayBuffer(65548);
      var worker = new Worker(new URL("/shared/fs-worker.js", location.href));
      worker.onmessage = function (e) {
        if (e.data && e.data.type === "ready") {
          resolve({ worker: worker, shared: shared });
        } else if (e.data && e.data.type === "error") {
          reject(new Error(e.data.message || "fs-worker init failed"));
        }
      };
      worker.onerror = function (err) {
        reject(err);
      };
      worker.postMessage({ type: "init", shared: shared, handle: handle });
    });
  }

  global.WebCodeWorkspace = {
    hostFsSupported: hostFsSupported,
    pickWorkspace: pickWorkspace,
    createHostFsWorker: createHostFsWorker,
  };
})(window);
