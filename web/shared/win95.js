(function (global) {
  "use strict";

  var overlayEl = null;

  function ensureOverlay() {
    if (!overlayEl) {
      overlayEl = document.createElement("div");
      overlayEl.className = "win95-overlay hidden";
      overlayEl.id = "win95-overlay";
      document.body.appendChild(overlayEl);
    }
    return overlayEl;
  }

  function showOverlay(windowEl) {
    var overlay = ensureOverlay();
    overlay.innerHTML = "";
    overlay.appendChild(windowEl);
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    if (overlayEl) {
      overlayEl.classList.add("hidden");
      overlayEl.innerHTML = "";
    }
  }

  function createWindow(title, wide) {
    var win = document.createElement("div");
    win.className = "win95-window" + (wide ? " wide" : "");
    win.innerHTML =
      '<div class="win95-titlebar">' +
        '<span class="win95-titlebar-text"></span>' +
      "</div>";
    win.querySelector(".win95-titlebar-text").textContent = title;
    return win;
  }

  function createButton(label, primary) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "win95-btn";
    btn.textContent = label;
    if (primary) {
      setTimeout(function () { btn.focus(); }, 0);
    }
    return btn;
  }

  function showProgressDialog(title, message) {
    var win = createWindow(title);
    var panel = document.createElement("div");
    panel.className = "win95-body-panel with-icon";
    panel.innerHTML =
      '<div class="win95-icon">💾</div>' +
      '<div class="win95-message">' +
        "<div></div>" +
        '<div class="win95-progress-wrap">' +
          '<div class="win95-progress-label">0%</div>' +
          '<div class="win95-progress-bar">' +
            '<div class="win95-progress-fill"></div>' +
          "</div>" +
        "</div>" +
      "</div>";
    panel.querySelector(".win95-message > div:first-child").textContent = message;
    win.appendChild(panel);
    showOverlay(win);

    var labelEl = panel.querySelector(".win95-progress-label");
    var fillEl = panel.querySelector(".win95-progress-fill");

    return {
      setProgress: function (pct) {
        var p = Math.max(0, Math.min(100, pct));
        labelEl.textContent = Math.round(p) + "%";
        fillEl.style.width = p + "%";
      },
      close: hideOverlay,
    };
  }

  function showConfirmDialog(opts) {
    return new Promise(function (resolve) {
      var win = createWindow(opts.title || "确认", true);
      var panel = document.createElement("div");
      panel.className = "win95-body-panel with-icon";
      panel.innerHTML =
        '<div class="win95-icon">⚠</div>' +
        '<div class="win95-message"></div>';
      panel.querySelector(".win95-message").textContent = opts.message || "";
      win.appendChild(panel);

      var buttons = document.createElement("div");
      buttons.className = "win95-buttons";
      var yesBtn = createButton(opts.yesLabel || "是 (Y)", true);
      var noBtn = createButton(opts.noLabel || "否 (N)", false);
      buttons.appendChild(yesBtn);
      buttons.appendChild(noBtn);
      win.appendChild(buttons);

      showOverlay(win);

      function cleanup() {
        hideOverlay();
        document.removeEventListener("keydown", onKey);
      }

      function onKey(e) {
        if (e.key === "y" || e.key === "Y") {
          cleanup();
          resolve(true);
        } else if (e.key === "n" || e.key === "N" || e.key === "Escape") {
          cleanup();
          resolve(false);
        }
      }

      document.addEventListener("keydown", onKey);
      yesBtn.addEventListener("click", function () {
        cleanup();
        resolve(true);
      });
      noBtn.addEventListener("click", function () {
        cleanup();
        resolve(false);
      });
    });
  }

  function showChoiceDialog(opts) {
    return new Promise(function (resolve) {
      var win = createWindow(opts.title || "选择", true);
      var panel = document.createElement("div");
      panel.className = "win95-body-panel with-icon";
      panel.innerHTML =
        '<div class="win95-icon">📁</div>' +
        '<div class="win95-message"></div>';
      panel.querySelector(".win95-message").textContent = opts.message || "";
      win.appendChild(panel);

      var buttons = document.createElement("div");
      buttons.className = "win95-buttons";
      var choiceBtns = [];
      (opts.choices || []).forEach(function (choice, idx) {
        var btn = createButton(choice.label, idx === 0);
        btn.addEventListener("click", function () {
          cleanup();
          resolve(choice.value);
        });
        choiceBtns.push(btn);
        buttons.appendChild(btn);
      });
      win.appendChild(buttons);
      showOverlay(win);

      function cleanup() {
        hideOverlay();
        document.removeEventListener("keydown", onKey);
      }

      function onKey(e) {
        if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      }

      document.addEventListener("keydown", onKey);
    });
  }

  global.Win95 = {
    showOverlay: showOverlay,
    hideOverlay: hideOverlay,
    showProgressDialog: showProgressDialog,
    showConfirmDialog: showConfirmDialog,
    showChoiceDialog: showChoiceDialog,
  };
})(window);
