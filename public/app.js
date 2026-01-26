// ==========================
// GLOBALS
// ==========================
const startBtn = document.getElementById("startBtn");
const startMenu = document.getElementById("startMenu");
const closeStart = document.getElementById("closeStart");
const windowContainer = document.getElementById("windowContainer");
const clock = document.getElementById("clock");

const taskbarIcons = document.querySelector(".taskbar-icons");

let zIndexCounter = 1;
var loadedModules = {};

async function saveDesktopState() {
  const windows = [];
  document.querySelectorAll('.window').forEach(win => {
    const appKey = win.dataset.appKey;
    const rect = win.getBoundingClientRect();
    const minimized = win.dataset.minimized === 'true';
    const maximized = win.classList.contains('maximized');
    const zIndex = parseInt(win.style.zIndex) || 1;
    const preview = minimized ? win.storedPreview : null;
    windows.push({
      appKey,
      top: win.style.top,
      left: win.style.left,
      width: win.style.width,
      height: win.style.height,
      minimized,
      maximized,
      zIndex,
      preview
    });
  });
  try {
    await fetch('/api/save-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows, zIndexCounter })
    });
  } catch (err) {
    console.warn('Failed to save state:', err);
  }
}

async function loadDesktopState() {
  try {
    const res = await fetch('/api/load-state');
    const state = await res.json();
    zIndexCounter = state.zIndexCounter || 1;
    for (const winState of state.windows) {
      await openApp(winState.appKey);
      // Get the last opened window for this app
      const instances = appInstances[winState.appKey];
      if (instances && instances.length > 0) {
        const win = instances[instances.length - 1];
        win.style.top = winState.top;
        win.style.left = winState.left;
        win.style.width = winState.width;
        win.style.height = winState.height;
        win.dataset.minimized = winState.minimized ? 'true' : 'false';
        win.style.zIndex = winState.zIndex;
        if (winState.minimized) {
          win.style.display = 'none';
          if (winState.preview) {
            win.storedPreview = winState.preview;
          }
        }
        if (winState.maximized) {
          win.classList.add('maximized');
        }
        updateTaskbarIndicator(winState.appKey);
      }
    }
  } catch (err) {
    console.warn('Failed to load state:', err);
  }
}


async function captureWindowPreview(windowEl) {
  const canvas = document.getElementById("previewCanvas");
  const ctx = canvas.getContext("2d");

  const rendered = await html2canvas(windowEl, { backgroundColor: null });

  canvas.width = rendered.width;
  canvas.height = rendered.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(rendered, 0, 0);

  return canvas.toDataURL("image/png");
}

function toggleStart() {
  startMenu.style.display = startMenu.style.display === "block" ? "none" : "block";
}

startBtn.addEventListener("click", toggleStart);
closeStart.addEventListener("click", () => (startMenu.style.display = "none"));

document.addEventListener("click", (e) => {
  if (!startMenu.contains(e.target) && !startBtn.contains(e.target)) {
    startMenu.style.display = "none";
  }
});

// helper: convert "/apps/software" => "software"
function getAppKey(app) {
  return app.replace("/apps/", "");
}

// ==========================
// APP RULES
// ==========================
var appRules = {};

// ==========================
// COMMUNITY APPS LOADER
// ==========================
async function loadCommunityApps() {
  try {
    const res = await fetch("/api/apps");
    const apps = await res.json();

    for (const app of apps) {
      appRules[app.name] = app.rules;

      // Get icon from appico tag
      try {
        const htmlRes = await fetch(`/apps/${app.name}/index.html`);
        const html = await htmlRes.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const appico = doc.querySelector('appico');
        if (appico && appico.getAttribute('src')) {
          appRules[app.name].icon = appico.getAttribute('src');
        } else {
          appRules[app.name].icon = `/apps/${app.name}/icon.png`;
        }
      } catch (err) {
        appRules[app.name].icon = `/apps/${app.name}/icon.png`;
      }

      // Add to taskbar and start menu if taskbarIcon is true
      if (app.rules.taskbarIcon) {
        // Check if already exists
        if (!document.querySelector(`.taskbar-icons [data-app="${app.name}"]`)) {
          // Taskbar icon
          const taskIcon = document.createElement("button");
          taskIcon.className = "task-icon";
          taskIcon.dataset.app = app.name;
          taskIcon.title = app.name;
          taskIcon.innerHTML = `<img src="${appRules[app.name].icon}" alt="${app.name}" class="app-icon" style="width: 100%; height: 100%; object-fit: contain;" onload="validateIconSize(this)">`;
          taskbarIcons.appendChild(taskIcon);
        }

        if (!document.querySelector(`.start-menu-grid [data-app="${app.name}"]`)) {
          // Start menu tile
          const startTile = document.createElement("button");
          startTile.className = "start-tile";
          startTile.dataset.app = app.name;
          startTile.innerHTML = `
            <div class="tile-icon"><img src="${appRules[app.name].icon}" alt="${app.name}" class="app-icon" style="width: 100%; height: 100%; object-fit: contain;" onload="validateIconSize(this)"></div>
            <div class="tile-title">${app.name}</div>
          `;
          document.querySelector('.start-menu-grid').appendChild(startTile);
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load community apps:", err);
  }
}

// run loader
loadCommunityApps().then(() => {
  loadDesktopState();
});

// Periodic save every 30 seconds
setInterval(saveDesktopState, 30000);

// Save on unload
window.addEventListener('beforeunload', saveDesktopState);

// ==========================
// START MENU
// ==========================
function toggleStart() {
  startMenu.style.display = startMenu.style.display === "block" ? "none" : "block";
}

startBtn.addEventListener("click", toggleStart);
closeStart.addEventListener("click", () => (startMenu.style.display = "none"));

document.addEventListener("click", (e) => {
  if (!startMenu.contains(e.target) && !startBtn.contains(e.target)) {
    startMenu.style.display = "none";
  }
});

// ==========================
// APP MANAGEMENT
// ==========================
const appInstances = {};
const menuTimers = {}; // <-- PER-APP TIMER
let activeStackApp = null; // prevents hover flicker

async function getAppRules(appKey) {
  const appPath = "/apps/" + appKey + "/app.properties.json";
  console.log("Fetching app rules from:", appPath);
  try {
    const res = await fetch(appPath);
    if (!res.ok) throw new Error('Network response was not ok');
    const rules = await res.json();
    console.log("Fetched app rules:", rules);
    appRules[appKey] = rules;
    return rules;
  } catch (error) {
    console.error(`Failed to fetch app rules: ${appPath}`, error);
    // If fetch failed, use cached from API or default
    if (appRules[appKey]) {
      console.log("Using cached app rules:", appRules[appKey], "for app:", appKey);
      return appRules[appKey];
    } else {
      const defaultRules = {
        maxInstances: 1,
        stack: false,
        resizable: true,
        minimize: true,
        maximize: true,
        taskbarIcon: false
      };
      appRules[appKey] = defaultRules;
      return defaultRules;
    }
  }
}

async function openApp(appKey) {
  const appPath = "/apps/" + appKey;
  const rules = await getAppRules(appKey);

  appInstances[appKey] = appInstances[appKey] || [];
  const instances = appInstances[appKey];

  // enforce max instances (unless -1)
  if (rules.maxInstances !== -1 && instances.length >= rules.maxInstances) {
    const winToFocus = instances[0];
    focusWindow(winToFocus);
    return;
  }

  const win = document.createElement("div");
  win.className = "window";
  win.style.top = "70px";
  win.style.left = "70px";
  win.style.zIndex = ++zIndexCounter;

  win.dataset.app = appPath;
  win.dataset.appKey = appKey;
  win.dataset.resizable = rules.resizable;
  win.dataset.minimize = rules.minimize;
  win.dataset.maximize = rules.maximize;
  win.dataset.minimized = "false";

  win.innerHTML = `
    <div class="window-header">
      <div class="window-title">${appKey.toUpperCase()}</div>
      <div class="window-controls">
        <button class="win-btn" data-action="minimize">▁</button>
        <button class="win-btn" data-action="maximize">▢</button>
        <button class="win-btn" data-action="close">✕</button>
      </div>
    </div>
    <div class="window-body">
      <div class="loading">Loading...</div>
    </div>
  `;

  windowContainer.appendChild(win);
  instances.push(win);

  // bring to front
  win.addEventListener("mousedown", () => {
    win.style.zIndex = ++zIndexCounter;
  });

  // load app content into window body
  fetch(`${appPath}/index.html`)
    .then((r) => r.text())
    .then((html) => {
      win.querySelector(".window-body").innerHTML = html;
      if (!loadedModules[appPath]) {
        return fetch(`/api/apps/${appKey}`)
          .then(r => r.json())
          .then(jsFiles => {
            const loadPromises = jsFiles.map(file => import(`${appPath}/${file}`));
            return Promise.all(loadPromises);
          })
          .then(modules => {
            loadedModules[appPath] = modules;
            // Call init for known apps
            const softwareModule = modules.find(m => m.softwareApp);
            if (softwareModule) {
              softwareModule.softwareApp.init(win.querySelector(".window-body"));
            }
            const osModule = modules.find(m => m.init);
            if (osModule) {
              osModule.init();
            }
          })
          .catch(err => console.error('Failed to load JS modules:', err));
      } else {
        // Already loaded, call init
        const softwareModule = loadedModules[appPath].find(m => m.softwareApp);
        if (softwareModule) {
          softwareModule.softwareApp.init(win.querySelector(".window-body"));
        }
        const osModule = loadedModules[appPath].find(m => m.init);
        if (osModule) {
          osModule.init();
        }
      }
    })
    .catch(() => {
      win.querySelector(".window-body").innerHTML = `<div class="aero-card"><p>Failed to load app.</p></div>`;
    });

  // window controls
  win.querySelector("[data-action='close']").addEventListener("click", () => {
    closeWindow(win);
  });

  const minBtn = win.querySelector("[data-action='minimize']");
  if (rules.minimize) {
    minBtn.addEventListener("click", () => minimizeWindow(win));
  } else {
    minBtn.style.display = "none";
  }

  const maxBtn = win.querySelector("[data-action='maximize']");
  if (rules.maximize) {
    maxBtn.addEventListener("click", () => maximizeWindow(win));
  } else {
    maxBtn.style.display = "none";
  }

  if (rules.resizable) {
    makeResizable(win);
  }

  makeDraggable(win);

 // Use launcher as indicator ONLY if stackable
 console.log("App rules for", appKey, ":", rules);
 console.log("Launcher element:", document.querySelector(`[data-app="${appKey}"]`));
  const launcher = document.querySelector(`[data-app="${appKey}"]`);
  console.log("Launcher found:", launcher);
  console.log("Stack rule:", rules.stack);  
  console.log("Taskbar Icon rule:", rules.taskbarIcon);

  // For non-stacking apps, create individual taskbar icon
  if (!rules.stack) {
    const icon = document.createElement("button");
    icon.className = "task-icon";
    const iconSrc = rules.icon || `/apps/${appKey}/icon.png`;
    icon.innerHTML = `<img src="${iconSrc}" alt="${appKey}" class="app-icon" style="width: 100%; height: 100%; object-fit: contain;" onload="validateIconSize(this)">`;
    icon.win = win;
    icon.addEventListener("click", () => {
      focusWindow(icon.win);
    });
    taskbarIcons.appendChild(icon);
    win.taskbarIcon = icon;
  }

  if (launcher && rules.stack) {
    if (!launcher.querySelector(".taskbar-indicator")) {
      const bar = document.createElement("div");
      bar.className = "taskbar-indicator";
      launcher.appendChild(bar);
    }
  }

  updateTaskbarIndicator(appKey);
}

function focusWindow(win) {
  win.dataset.minimized = "false";
  win.style.display = "block";
  win.style.zIndex = ++zIndexCounter;
  // If it was temp unminimized, reset the styles
  if (win.isTempUnminimized) {
    win.style.opacity = "";
    win.style.pointerEvents = "";
    win.style.border = "";
    win.style.boxShadow = "";
    delete win.isTempUnminimized;
  }
}

function closeWindow(win) {
  const appKey = win.dataset.appKey;
  appInstances[appKey] = appInstances[appKey].filter((w) => w !== win);
  if (win.taskbarIcon) {
    win.taskbarIcon.remove();
  }
  win.remove();
  updateTaskbarIndicator(appKey);
  const appPath = win.dataset.app;
  if (loadedModules[appPath]) {
    delete loadedModules[appPath];
  }
}

function minimizeWindow(win) {
  // capture preview before hiding
  html2canvas(win, { backgroundColor: null }).then(canvas => {
    win.storedPreview = canvas.toDataURL("image/png");
  });
  win.dataset.minimized = "true";
  win.minimizedAt = Date.now(); // track minimization time
  win.style.display = "none";
  updateTaskbarIndicator(win.dataset.appKey);
}

function updateTaskbarIndicator(appKey) {
  const rules = appRules[appKey] || {};
  const launcher = document.querySelector(`[data-app="${appKey}"]`);

  const instances = appInstances[appKey] || [];
  const show = instances.length > 0;

  if (launcher && rules.stack) {
    const bar = launcher.querySelector(".taskbar-indicator");
    if (bar) bar.style.display = show ? "block" : "none";
  }
}

// =============================
// LIVE PREVIEW (Windows-style)
// =============================
async function createLivePreview(win) {
  const preview = document.createElement("div");
  preview.className = "stack-preview";

  const inner = document.createElement("div");
  inner.className = "stack-preview-inner";

  let imgSrc;
  if (win.dataset.minimized === "true" && win.storedPreview) {
    imgSrc = win.storedPreview;
  } else if (win.style.display === "none" && win.storedPreview) {
    // If window is hidden but not minimized, use stored preview
    imgSrc = win.storedPreview;
  } else {
    const canvas = await html2canvas(win, { backgroundColor: null });
    imgSrc = canvas.toDataURL("image/png");
    win.storedPreview = imgSrc; // store for future use
  }

  const img = document.createElement("img");
  img.src = imgSrc;
  img.className = "stack-preview-img";
  inner.appendChild(img);

  preview.appendChild(inner);
  return preview;
}

// Phantom window functions (temporarily unminimize)
function showTempUnminimized(win) {
  if (win.dataset.minimized !== "true") return; // don't show if already unminimized
  hideAllTempUnminimized(); // ensure only one at a time
  win.style.display = "block";
  win.style.opacity = "0.8";
  win.style.pointerEvents = "none";
  win.style.zIndex = "9999";
  win.style.border = "2px solid #0078d4";
  win.style.boxShadow = "0 0 20px rgba(0,120,212,0.5)";
  win.isTempUnminimized = true;
}

function hideTempUnminimized(win) {
  if (win.isTempUnminimized) {
    win.style.display = "none";
    win.style.opacity = "";
    win.style.pointerEvents = "";
    win.style.zIndex = "";
    win.style.border = "";
    win.style.boxShadow = "";
    delete win.isTempUnminimized;
  }
}

function hideAllTempUnminimized() {
  document.querySelectorAll('.window').forEach(win => {
    if (win.isTempUnminimized) {
      hideTempUnminimized(win);
    }
  });
}

async function openStackMenu(app, icon) {
  // remove any other app's stack menu
  document.querySelectorAll(".stack-menu").forEach(m => m.remove());
  hideAllTempUnminimized(); // hide any temp unminimized

  const instances = appInstances[app] || [];
  if (instances.length === 0) return;

  const menu = document.createElement("div");
  menu.className = "stack-menu";

  const row = document.createElement("div");
  row.className = "stack-items-row";
  menu.appendChild(row);

  for (let i = 0; i < instances.length; i++) {
    const win = instances[i];

    const item = document.createElement("div");
    item.className = "stack-item";

    item.innerHTML = `
      <div class="stack-left">
        <span class="stack-icon">⬇️</span>
        <span class="stack-title">${app.toUpperCase()} (${i + 1})</span>
        <button class="stack-close">✕</button>
      </div>
    `;

    const closeBtn = item.querySelector(".stack-close");
    const preview = await createLivePreview(win);

    item.appendChild(preview);

    item.addEventListener("click", () => {
      focusWindow(win);
      menu.remove();
      hideAllTempUnminimized();
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWindow(win);
      menu.remove();
      hideAllTempUnminimized();
    });

    // Add temp unminimize hover
    item.addEventListener("mouseenter", () => {
      if (item.hoverTimeout) clearTimeout(item.hoverTimeout);
      item.hoverTimeout = setTimeout(() => showTempUnminimized(win), 500);
    });

    item.addEventListener("mouseleave", () => {
      if (item.hoverTimeout) clearTimeout(item.hoverTimeout);
      hideTempUnminimized(win);
    });

    row.appendChild(item);
  }

  document.body.appendChild(menu);

  requestAnimationFrame(() => {
    const rect = icon.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const taskbarHeight = 54;

    let top = rect.top - menuRect.height - 10;
    let left = rect.left + rect.width / 2 - menuRect.width / 2;

    if (top < 0) {
      top = rect.bottom + 10;
    }

    const maxLeft = window.innerWidth - menuRect.width - 10;
    if (left > maxLeft) left = maxLeft;
    if (left < 10) left = 10;

    const bottom = top + menuRect.height;
    if (bottom > window.innerHeight - taskbarHeight) {
      top = window.innerHeight - taskbarHeight - menuRect.height - 10;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.zIndex = "10000"; // ensure menu is above temp unminimized windows
  });

  menu.addEventListener("mouseenter", () => {
    clearTimeout(menuTimers[app]);
  });

  menu.addEventListener("mouseleave", () => {
    menuTimers[app] = setTimeout(() => {
      menu.remove();
      hideAllTempUnminimized();
    }, 200);
  });
}


function maximizeWindow(win) {
  if (win.classList.contains("maximized")) {
    win.classList.remove("maximized");
    win.style.width = "";
    win.style.height = "";
    win.style.top = "70px";
    win.style.left = "70px";
  } else {
    win.classList.add("maximized");
    win.style.top = "0";
    win.style.left = "0";
    win.style.width = "100%";
    win.style.height = "calc(100% - 54px)";
  }
}

function makeDraggable(win) {
  const header = win.querySelector(".window-header");
  let dragging = false;
  let offsetX, offsetY;

  header.addEventListener("mousedown", (e) => {
    dragging = true;
    offsetX = e.clientX - win.offsetLeft;
    offsetY = e.clientY - win.offsetTop;
    header.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    win.style.left = `${e.clientX - offsetX}px`;
    win.style.top = `${e.clientY - offsetY}px`;
  });

  document.addEventListener("mouseup", () => {
    dragging = false;
    header.style.cursor = "grab";
  });
}

function makeResizable(win) {
  let resizing = false;
  let resizeMode = '';
  let startX, startY, startWidth, startHeight, startLeft, startTop;

  const threshold = 10; // pixels from edge to trigger resize

  function getResizeMode(e) {
    const rect = win.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    let mode = '';

    if (y < threshold) mode += 'n';
    else if (y > h - threshold) mode += 's';

    if (x < threshold) mode += 'w';
    else if (x > w - threshold) mode += 'e';

    return mode;
  }

  win.addEventListener("mousemove", (e) => {
    if (resizing) return;
    const mode = getResizeMode(e);
    if (mode) {
      const cursors = {
        'n': 'n-resize',
        's': 's-resize',
        'e': 'e-resize',
        'w': 'w-resize',
        'ne': 'ne-resize',
        'nw': 'nw-resize',
        'se': 'se-resize',
        'sw': 'sw-resize'
      };
      win.style.cursor = cursors[mode] || 'default';
    } else {
      win.style.cursor = 'default';
    }
  });

  win.addEventListener("mousedown", (e) => {
    const mode = getResizeMode(e);
    if (mode) {
      resizing = true;
      resizeMode = mode;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = win.offsetWidth;
      startHeight = win.offsetHeight;
      startLeft = win.offsetLeft;
      startTop = win.offsetTop;
      e.preventDefault();
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (resizeMode.includes('e')) {
      const newWidth = Math.max(200, startWidth + dx);
      win.style.width = `${newWidth}px`;
    }
    if (resizeMode.includes('s')) {
      const newHeight = Math.max(100, startHeight + dy);
      win.style.height = `${newHeight}px`;
    }
    if (resizeMode.includes('w')) {
      const newWidth = Math.max(200, startWidth - dx);
      win.style.width = `${newWidth}px`;
      win.style.left = `${startLeft + dx}px`;
    }
    if (resizeMode.includes('n')) {
      const newHeight = Math.max(100, startHeight - dy);
      win.style.height = `${newHeight}px`;
      win.style.top = `${startTop + dy}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    resizing = false;
    resizeMode = '';
  });
}

// clock
setInterval(() => {
  const clock = document.getElementById("clock");
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const mins = String(now.getMinutes()).padStart(2, "0");
  clock.textContent = `${hours}:${mins}`;
}, 1000);

// DOUBLE CLICK LAUNCHER SETUP
document.querySelectorAll("[data-app]").forEach((btn) => {
  let clickCount = 0;
  let timer = null;

  btn.addEventListener("click", () => {
    clickCount++;

    if (clickCount === 1) {
      timer = setTimeout(() => {
        clickCount = 0;
        // Single click: open most recent minimized window
        const appKey = btn.dataset.app;
        const instances = appInstances[appKey] || [];
        const minimizedInstances = instances.filter(win => win.dataset.minimized === "true");
        if (minimizedInstances.length > 0) {
          // Sort by minimization time, most recent first
          minimizedInstances.sort((a, b) => b.minimizedAt - a.minimizedAt);
          focusWindow(minimizedInstances[0]);
        } else {
          // If no minimized, show stack menu if applicable
          const rules = appRules[appKey] || {};
          if (rules.stack && instances.length > 0) {
            openStackMenu(appKey, btn);
          }
        }
      }, 250);
    }

    if (clickCount === 2) {
      clearTimeout(timer);
      clickCount = 0;
      openApp(btn.dataset.app);
      startMenu.style.display = "none";
    }
  });

  // hover menu only for launcher
  btn.addEventListener("mouseenter", () => {
    clearTimeout(menuTimers[btn.dataset.app]);
    const rules = appRules[btn.dataset.app] || {};
    if (rules.stack) openStackMenu(btn.dataset.app, btn);
  });

  btn.addEventListener("mouseleave", () => {
    menuTimers[btn.dataset.app] = setTimeout(() => {
      const menu = document.querySelector(".stack-menu");
      if (menu && !menu.matches(":hover")) menu.remove();
    }, 200);
  });
});
