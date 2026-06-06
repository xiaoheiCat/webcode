(function (global) {
  "use strict";

  var STACK_ADDRESS = "http://localhost:9999/";

  function assetUrl(base, path) {
    return new URL(path, base).href;
  }

  function genMac() {
    return "02:XX:XX:XX:XX:XX".replace(/X/g, function () {
      return "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16));
    });
  }

  function buildPackInfo() {
    var info = "t:" + Math.round(Date.now() / 1000) + "\n";
    info += "n:" + genMac() + "\n";
    info += "m: .wasmenv\n";
    info += "env: SSL_CERT_FILE=/.wasmenv/proxy.crt\n";
    info += "env: https_proxy=http://192.168.127.253:80\n";
    info += "env: http_proxy=http://192.168.127.253:80\n";
    info += "env: HTTPS_PROXY=http://192.168.127.253:80\n";
    info += "env: HTTP_PROXY=http://192.168.127.253:80\n";
    info += "env: TERM=xterm-256color\n";
    info += "env: COLORTERM=truecolor\n";
    return info;
  }

  function writePackInfo(mod, info) {
    try {
      mod.FS.mkdir("/pack");
    } catch (e) {}
    mod.FS.writeFile("/pack/info", info);
  }

  function loadClassicScript(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = url;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        reject(new Error("Failed to load script: " + url));
      };
      document.head.appendChild(script);
    });
  }

  function loadLoadJsIfPresent(base) {
    var loadUrl = assetUrl(base, "load.js");
    return fetch(loadUrl, { method: "HEAD", credentials: "same-origin" }).then(function (resp) {
      if (!resp.ok) {
        return;
      }
      return loadClassicScript(loadUrl);
    });
  }

  function bootEmscriptenModule(base, Module) {
    var outUrl = assetUrl(base, "out.js");
    return loadLoadJsIfPresent(base)
      .then(function () {
        return import(assetUrl(base, "arg-module.js"));
      })
      .then(function () {
        return import(outUrl);
      })
      .then(function (initEmscriptenModule) {
        return initEmscriptenModule.default(Module);
      });
  }

  function startEmscripten(base, slave, fitTerminal) {
    var outUrl = assetUrl(base, "out.js");
    var Module = {
      pty: slave,
      preRun: [],
      mainScriptUrlOrBlob: outUrl,
      websocket: {
        url: STACK_ADDRESS,
      },
      locateFile: function (path) {
        return assetUrl(base, path);
      },
    };
    global.Module = Module;

    var info = buildPackInfo();
    var proxyWasm = assetUrl(base, "c2w-net-proxy.wasm");
    var stackWorker = assetUrl(base, "stack-worker.js");

    return new Promise(function (resolve, reject) {
      Stack.Start(STACK_ADDRESS, stackWorker, proxyWasm, function (cert) {
        Module.preRun.push(function (mod) {
          try {
            mod.FS.mkdir("/.wasmenv");
          } catch (e) {}
          mod.FS.writeFile("/.wasmenv/proxy.crt", cert);
          writePackInfo(mod, info);
        });

        if (fitTerminal) {
          try { fitTerminal(); } catch (e) {}
        }

        bootEmscriptenModule(base, Module)
          .then(function (instance) {
            if (fitTerminal) {
              try { fitTerminal(); } catch (e) {}
            }
            resolve(instance);
          })
          .catch(reject);
      });
    });
  }

  global.WebCodeEmscripten = {
    STACK_ADDRESS: STACK_ADDRESS,
    startEmscripten: startEmscripten,
  };
})(window);
