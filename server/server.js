const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// maps to track native app sessions and pending UAC requests
const nativeSessions = new Map(); 
// instanceId -> { appKey, pid, type, url }
const pendingUAC = new Map(); // socket.id -> { command, risks }

// ==============================
// PATHS
// ==============================
const PUBLIC_DIR = path.join(__dirname, "../public");
const APPS_DIR = path.join(PUBLIC_DIR, "apps");
const SOFTWARE_DIR = path.join(__dirname, "uploads");
const USER_CONFIG_FILE = path.join(__dirname, "userConfig.json");
const STATE_FILE = path.join(__dirname, "desktopState.json");
const OS_FILE = path.join(__dirname, "os", "FrutigerAeroOS.exe");

// ==============================
// MIDDLEWARE
// ==============================
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ==============================
// HELPERS
// ==============================
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function ensureFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// ==============================
// BOOTSTRAP FILES
// ==============================
ensureFile(USER_CONFIG_FILE, { installedApps: {} });
ensureFile(STATE_FILE, { windows: [], zIndexCounter: 1 });

// ==============================
// API: SOFTWARE LIST
// ==============================
app.get("/api/software", (req, res) => {
  if (!fs.existsSync(SOFTWARE_DIR)) return res.json([]);

  const files = fs.readdirSync(SOFTWARE_DIR);
  res.json(
    files.map(file => {
      const fullPath = path.join(SOFTWARE_DIR, file);
      const stats = fs.statSync(fullPath);
      return {
        file,
        name: path.parse(file).name,
        version: "1.0.0",
        size: `${Math.round(stats.size / 1024 / 1024)} MB`,
        sha: sha256File(fullPath),
        icon: "⬇️"
      };
    })
  );
});

// ==============================
// API: COMMUNITY APPS
// ==============================
app.get("/api/apps", (req, res) => {
  if (!fs.existsSync(APPS_DIR)) return res.json([]);

  const DEFAULT_RULES = {
    maxInstances: 1,
    stack: false,
    resizable: true,
    minimize: true,
    maximize: true,
    startPin: false,
    addedTaskBar: false,
    sessionState: false   // ✅ enable session state restoration
  };

  const apps = fs.readdirSync(APPS_DIR)
    .filter(name => fs.statSync(path.join(APPS_DIR, name)).isDirectory())
    .map(name => {
      const propsPath = path.join(APPS_DIR, name, "app.properties.json");
      const rules = fs.existsSync(propsPath)
        ? { ...DEFAULT_RULES, ...readJSON(propsPath, {}) }
        : DEFAULT_RULES;

      return { name, rules };
    });

  res.json(apps);
});

// ==============================
// API: USER CONFIG
// ==============================
app.get("/api/user-config", (req, res) => {
  res.json(readJSON(USER_CONFIG_FILE, { installedApps: {} }));
});

app.post("/api/install", (req, res) => {
  const { appId, addedTo } = req.body;
  const config = readJSON(USER_CONFIG_FILE, { installedApps: {} });

  config.installedApps[appId] = {
    installed: true,
    addedTo,
    asked: true
  };

  fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(config, null, 2));
  res.json({ success: true });
});

// ==============================
// API: DESKTOP STATE
// ==============================
app.post("/api/save-state", (req, res) => {
  fs.writeFileSync(STATE_FILE, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

app.get("/api/load-state", (req, res) => {
  res.json(readJSON(STATE_FILE, { windows: [], zIndexCounter: 1 }));
});

// ==============================
// API: APP JS FILES
// ==============================
app.get("/api/apps/:appname", (req, res) => {
  const appDir = path.join(APPS_DIR, req.params.appname);
  if (!fs.existsSync(appDir)) {
    return res.status(404).json({ error: "App not found" });
  }

  const jsFiles = fs.readdirSync(appDir).filter(f => f.endsWith(".js"));
  res.json(jsFiles);
});

// ==============================
// API: APP FILES (JS AND CSS)
// ==============================
app.get("/api/apps/:appname/files", (req, res) => {
  const appDir = path.join(APPS_DIR, req.params.appname);
  if (!fs.existsSync(appDir)) {
    return res.status(404).json({ error: "App not found" });
  }

  const jsFiles = fs.readdirSync(appDir).filter(f => f.endsWith(".js"));
  const cssFiles = fs.readdirSync(appDir).filter(f => f.endsWith(".css"));
  
  res.json({ js: jsFiles, css: cssFiles });
});

// ==============================
// DOWNLOADS
// ==============================
app.get("/apps/os", (req, res) => {
  res.download(OS_FILE);
});

app.get("/download/software/:file", (req, res) => {
  res.download(path.join(SOFTWARE_DIR, req.params.file));
});


// ==============================
// FALLBACK (SPA ROUTING)
// ==============================
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ==============================
// NATIVE APP STREAM REDIRECT
// ==============================
app.get("/stream/:instanceId", (req, res) => {
  const session = nativeSessions.get(req.params.instanceId);
  if (!session || !session.url) {
    return res.status(404).send("No active stream");
  }
  res.redirect(session.url);
});


// ==============================
// START SERVER
// ==============================
server.listen(PORT, () => {
  // Initialize desktopState.json if it doesn't exist
  if (!fs.existsSync(STATE_FILE)) {
    const initialState = { windows: [], zIndexCounter: 1 };
    fs.writeFileSync(STATE_FILE, JSON.stringify(initialState, null, 2));
  }
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// com

const { exec } = require("child_process");

const BLACKLISTED_COMMANDS = [
  'rm -rf /',
  ':(){ :|:& };:', // fork bomb
  'mkfs',
  'dd if=',
];

const RISKY_KEYWORDS = [
  'sudo',
  'rm',
  'chmod',
  'chown',
  'apt',
  'dnf',
  'pacman',
  'systemctl',
  'service',
  'kill',
  'cat /dev',
];

app.post("/api/exec", async (req, res) => {
  const { command } = req.body;
  const socketId = req.headers["x-socket-id"];
  const socket = socketClients.get(socketId);

  if (!socket) {
    return res.status(403).json({ error: "No active session" });
  }

  // 🚫 Hard blacklist (never allowed)
  const blacklistedCommands = [
    "rm -rf /",
    ":(){ :|:& };:",
  ];

  if (blacklistedCommands.some(bad => command.includes(bad))) {
    return res.status(403).json({ error: "Command permanently blocked" });
  }

  // ⚠️ Commands requiring UAC
  const riskyPatterns = ["sudo", "rm", "dd", "mount", "chmod", "chown"];

  const risks = riskyPatterns.filter(r => command.includes(r));

  if (risks.length > 0 && !socket.uacApproved) {
    socket.emit("uac:required", {
      command,
      risks
    });

    return res.json({ pending: true });
  }

  socket.uacApproved = false; // reset after use

  exec(command, (error, stdout, stderr) => {
    console.log("🟢 EXEC CALLBACK FIRED");

    if (error) {
      console.error("🔴 EXEC ERROR:", error.message);
    }

    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);

    socket.emit("exec:result", {
      stdout,
      stderr,
      error: error?.message || null
    });
  });
  
  res.json({ success: true });
});



// UAC socket.io
const socketClients = new Map();

io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id);
  socketClients.set(socket.id, socket);

  socket.on("disconnect", () => {
    socketClients.delete(socket.id);
  });

  socket.on("uac:approve", () => {
    socket.uacApproved = true;
  });

  socket.on("uac:deny", () => {
    socket.uacApproved = false;
  });

  socket.on("native:launch", ({ appKey, instanceId, command, stream }) => {
    const propsPath = path.join(APPS_DIR, appKey, "app.properties.json");
    const rules = readJSON(propsPath, {});

    // trust client override only if defined in properties
    rules.command = rules.command || command;
    rules.backend = stream || rules.backend;

    launchApp(appKey, instanceId, rules, socket);
  });

  socket.on("native:kill", ({ instanceId }) => {
    const session = nativeSessions.get(instanceId);
    if (!session) return;

    try {
      process.kill(session.pid);
    } catch {}

    nativeSessions.delete(instanceId);
  });
});
// ==============================

// App launch helper
function launchApp(appKey, rules, socket) {
  switch (rules.backend) {

    case "exec": {
      const child = exec(rules.command);
      nativeSessions.set(instanceId, {
        appKey,
        pid: child.pid,
        type: "exec"
      });

      child.stdout?.on("data", d => {
        socket.emit("app:output", { appKey, stdout: d.toString() });
      });

      child.stderr?.on("data", d => {
        socket.emit("app:output", { appKey, stderr: d.toString() });
      });
      break;
    }

    case "xpra":
      launchXpra(appKey, rules, socket);
      break;

    case "sunshine":
      launchSunshine(appKey, rules, socket);
      break;

    default:
      // web apps handled client-side
      break;
  }
}

function launchXpra(appKey, rules, socket) {
  const display = `:${100 + Math.floor(Math.random() * 100)}`;

  const cmd = `
    xpra start ${display}
    --start-child=${rules.command}
    --html=on
    --bind-tcp=127.0.0.1:0
  `;

  exec(cmd, (err, stdout) => {
    if (err) {
      socket.emit("app:error", { appKey, error: err.message });
      return;
    }

    const match = stdout.match(`/port (\d+)/`);
    if (!match) return;

    const url = `http://localhost:${match[1]}`;

    nativeSessions.set(instanceId, {
      appKey,
      pid: null,
      type: "xpra",
      url
    });

    socket.emit("app:stream", {
      instanceId,
      appKey,
      type: "xpra",
      url
    });
  });
}

function launchSunshine(appKey, rules, socket) {
  exec(`sunshine --start ${rules.command}`, (err) => {
    if (err) {
      socket.emit("app:error", { appKey, error: err.message });
      return;
    }

    socket.emit("app:stream", {
      appKey,
      type: "sunshine",
      url: "moonlight://localhost"
    });
  });
}
// ==============================