(function (global) {
  "use strict";

  var STACK_ADDRESS = "http://localhost:9999/";

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

  function installPtyPoll(Module, slave) {
    var readableCallbacks = [];
    slave.onReadable(function () {
      readableCallbacks.forEach(function (cb) { cb(); });
      readableCallbacks = [];
    });
    Module.preRun.push(function (mod) {
      mod.TTY.stream_ops.poll = function (stream, timeout, notifyCallback) {
        if (Module.pty.readable) {
          return 1;
        }
        if (notifyCallback != null) {
          notifyCallback.registerCleanupFunc(function () {
            var i = readableCallbacks.indexOf(notifyCallback);
            if (i !== -1) {
              readableCallbacks.splice(i, 1);
            }
          });
          readableCallbacks.push(notifyCallback);
        }
        return 0;
      };
    });
  }

  function writePackInfo(mod, info) {
    try {
      mod.FS.mkdir("/pack");
    } catch (e) {}
    mod.FS.writeFile("/pack/info", info);
  }

  function startEmscripten(base, slave, fitAddon) {
    var Module = {
      pty: slave,
      preRun: [],
      mainScriptUrlOrBlob: base + "out.js",
      websocket: {
        url: STACK_ADDRESS,
      },
    };
    global.Module = Module;

    installPtyPoll(Module, slave);

    var info = buildPackInfo();
    var proxyWasm = base + "c2w-net-proxy.wasm";

    return new Promise(function (resolve, reject) {
      Stack.Start(STACK_ADDRESS, base + "stack-worker.js", proxyWasm, function (cert) {
        Module.preRun.push(function (mod) {
          try {
            mod.FS.mkdir("/.wasmenv");
          } catch (e) {}
          mod.FS.writeFile("/.wasmenv/proxy.crt", cert);
          writePackInfo(mod, info);
        });

        var argScript = document.createElement("script");
        argScript.src = base + "arg-module.js";
        argScript.onload = function () {
          import(base + "out.js")
            .then(function (initEmscriptenModule) {
              return initEmscriptenModule.default(Module);
            })
            .then(function (instance) {
              if (fitAddon) {
                try { fitAddon.fit(); } catch (e) {}
              }
              resolve(instance);
            })
            .catch(reject);
        };
        argScript.onerror = reject;
        document.head.appendChild(argScript);
      });
    });
  }

  global.WebCodeEmscripten = {
    STACK_ADDRESS: STACK_ADDRESS,
    startEmscripten: startEmscripten,
  };
})(window);
