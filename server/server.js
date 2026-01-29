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
// instanceId -> { appKey, pid, type, url, display, port }
const pendingUAC = new Map(); // socket.id -> { command, risks }

// Track Xpra port allocations (starting from 10001)
let nextXpraPort = 10001;
const xpraPortsInUse = new Set();

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
    .map(folderName => {
      const propsPath = path.join(APPS_DIR, folderName, "app.properties.json");
      const rules = fs.existsSync(propsPath)
        ? { ...DEFAULT_RULES, ...readJSON(propsPath, {}) }
        : DEFAULT_RULES;

      return { folderName, rules };
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
    console.log(`🎮 Launching native app: ${appKey}, stream: ${stream}, instance: ${instanceId}`);
    
    const propsPath = path.join(APPS_DIR, appKey, "app.properties.json");
    const rules = readJSON(propsPath, {});

    // trust client override only if defined in properties
    rules.command = rules.command || command;
    rules.stream = stream || rules.stream;

    if (rules.stream === "vnc" || rules.stream === "xpra") {
      launchXpra(appKey, rules, socket, instanceId);
    } else if (rules.stream === "sunshine") {
      launchSunshine(appKey, rules, socket, instanceId);
    } else {
      socket.emit("app:error", { 
        appKey,
        instanceId, 
        error: `Unknown stream type: ${rules.stream}` 
      });
    }
  });

  socket.on("native:kill", ({ instanceId }) => {
    const session = nativeSessions.get(instanceId);
    if (!session) return;

    console.log(`🛑 Killing native app instance: ${instanceId}`);
    
    if ((session.type === 'xpra' || session.type === 'vnc') && session.display) {
      // Stop VNC session (Xvfb + x11vnc + websockify)
      const displayNum = session.display.replace(':', '');
      
      // Kill x11vnc server
      exec(`pkill -f "x11vnc.*${session.display}"`, (err) => {
        if (err) console.error("Error stopping x11vnc:", err);
        else console.log(`✅ Stopped x11vnc for display ${session.display}`);
      });
      
      // Kill websockify proxy
      if (session.webPort) {
        exec(`pkill -f "websockify.*${session.webPort}"`, (err) => {
          if (err) console.error("Error stopping websockify:", err);
          else console.log(`✅ Stopped websockify on port ${session.webPort}`);
        });
        
        // Free up the port
        xpraPortsInUse.delete(session.webPort);
        console.log(`✅ Released port ${session.webPort}`);
      }
      
      // Kill Xvfb virtual display
      exec(`pkill -f "Xvfb ${session.display}"`, (err) => {
        if (err) console.error("Error stopping Xvfb:", err);
        else console.log(`✅ Stopped Xvfb display ${session.display}`);
      });
    } else if (session.type === 'sunshine' || session.type === 'moonlight') {
      // Kill Moonlight client
      exec('pkill -f moonlight', (err) => {
        if (err) console.error('Error stopping Moonlight:', err);
        else console.log(`✅ Stopped Moonlight client`);
      });
    }

    if (session.pid) {
      try {
        process.kill(session.pid);
      } catch (err) {
        console.error("Error killing process:", err);
      }
    }

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

function launchXpra(appKey, rules, socket, instanceId) {
  const appCommand = rules.command || 'xterm';
  
  // Allocate unique ports for this instance
  const vncPort = 5900 + nextXpraPort;  // VNC port
  const webPort = 6080 + nextXpraPort;  // noVNC websockify port
  const display = `:${nextXpraPort}`;
  
  nextXpraPort++;
  xpraPortsInUse.add(webPort);
  
  console.log(`🚀 Creating isolated VNC session for ${appCommand}`);
  console.log(`   Display: ${display}, VNC Port: ${vncPort}, Web Port: ${webPort}`);

  // Start virtual X server with the app
  const xvfbCmd = `Xvfb ${display} -screen 0 1280x720x24 &`;
  
  exec(xvfbCmd, (xvfbErr) => {
    if (xvfbErr) {
      console.error(`❌ Failed to start Xvfb:`, xvfbErr);
      xpraPortsInUse.delete(webPort);
      socket.emit("app:error", { 
        appKey, 
        instanceId, 
        error: `Failed to start virtual display.\n\nError: ${xvfbErr.message}` 
      });
      return;
    }

    // Wait for Xvfb to be ready
    setTimeout(() => {
      // Start openbox window manager
      exec(`DISPLAY=${display} openbox &`, (wmErr) => {
        if (wmErr) console.error(`Warning: Failed to start openbox:`, wmErr);
      });

      // Start the application
      exec(`DISPLAY=${display} ${appCommand} &`, (appErr) => {
        if (appErr) {
          console.error(`❌ Failed to start ${appCommand}:`, appErr);
          xpraPortsInUse.delete(webPort);
          socket.emit("app:error", { 
            appKey, 
            instanceId, 
            error: `Failed to start application.\n\nError: ${appErr.message}` 
          });
          return;
        }

        console.log(`✅ Application started: ${appCommand}`);

        // Start x11vnc to stream the display
        const vncCmd = `x11vnc -display ${display} -rfbport ${vncPort} -forever -shared -nopw -quiet &`;
        
        exec(vncCmd, (vncErr) => {
          if (vncErr) {
            console.error(`❌ Failed to start x11vnc:`, vncErr);
            xpraPortsInUse.delete(webPort);
            socket.emit("app:error", { 
              appKey, 
              instanceId, 
              error: `Failed to start VNC server.\n\nError: ${vncErr.message}` 
            });
            return;
          }

          console.log(`✅ VNC server started on port ${vncPort}`);

          // Start websockify (noVNC proxy)
          const websockifyCmd = `websockify --web=/opt/noVNC ${webPort} localhost:${vncPort} &`;
          
          exec(websockifyCmd, (wsErr) => {
            if (wsErr) {
              console.error(`❌ Failed to start websockify:`, wsErr);
              xpraPortsInUse.delete(webPort);
              socket.emit("app:error", { 
                appKey, 
                instanceId, 
                error: `Failed to start web proxy.\n\nError: ${wsErr.message}` 
              });
              return;
            }

            console.log(`✅ noVNC ready on port ${webPort}`);

            // Wait for everything to be fully ready
            setTimeout(() => {
              const url = `http://localhost:${webPort}/vnc.html?autoconnect=true&resize=scale`;
              
              nativeSessions.set(instanceId, {
                appKey,
                type: "vnc",
                url,
                vncPort,
                webPort,
                display,
                command: appCommand
              });

              socket.emit("app:stream", {
                instanceId,
                appKey,
                type: "vnc",
                url
              });
            }, 2000);
          });
        });
      });
    }, 1000); // Wait for Xvfb to be ready
  });
}

function launchSunshine(appKey, rules, socket, instanceId) {
  // Check if Sunshine is actually running (process or service)
  exec('pgrep -f sunshine || systemctl --user is-active sunshine.service', (err, stdout) => {
    const isRunning = stdout.trim() && (stdout.includes('active') || /^\d+/.test(stdout.trim()));
    
    if (isRunning) {
      console.log('✅ Sunshine is running');
      launchMoonlightClient(appKey, rules, socket, instanceId);
      return;
    }

    // Try to start Sunshine service
    console.log('⚙️ Starting Sunshine service...');
    exec('systemctl --user start sunshine.service', (startErr) => {
      if (startErr) {
        console.error('❌ Failed to start Sunshine service:', startErr);
        socket.emit("app:error", { 
          appKey, 
          instanceId, 
          error: "Failed to start Sunshine.\n\nTroubleshooting:\n• Make sure Sunshine is installed (flatpak)\n• Make sure Moonlight is installed (flatpak)\n• Pair Moonlight with Sunshine first\n• Check Sunshine web UI: https://localhost:47990" 
        });
        return;
      }

      // Wait for Sunshine to initialize
      setTimeout(() => launchMoonlightClient(appKey, rules, socket, instanceId), 5000);
    });
  });
}

function launchMoonlightClient(appKey, rules, socket, instanceId) {
  const appName = rules.command || 'Desktop';
  
  // Check for user flatpak Moonlight (recommended installation method)
  exec('flatpak list --user --app 2>/dev/null | grep com.moonlight_stream.Moonlight', (userErr, userOut) => {
    if (!userErr && userOut.trim()) {
      // User flatpak found
      console.log(`🎮 Launching Moonlight (user flatpak) for: ${appName}`);
      const moonlightCmd = `DISPLAY=${process.env.DISPLAY || ':0'} flatpak run --user com.moonlight_stream.Moonlight stream localhost "${appName}" &`;
      executeMoonlight(moonlightCmd, appKey, socket, instanceId, rules);
      return;
    }
    
    // Check for system flatpak
    exec('flatpak list --system --app 2>/dev/null | grep com.moonlight_stream.Moonlight', (sysErr, sysOut) => {
      if (!sysErr && sysOut.trim()) {
        console.log(`🎮 Launching Moonlight (system flatpak) for: ${appName}`);
        const moonlightCmd = `DISPLAY=${process.env.DISPLAY || ':0'} flatpak run com.moonlight_stream.Moonlight stream localhost "${appName}" &`;
        executeMoonlight(moonlightCmd, appKey, socket, instanceId, rules);
        return;
      }
      
      // Try native installation
      exec('which moonlight-qt', (nativeErr, nativePath) => {
        if (!nativeErr && nativePath.trim()) {
          console.log(`🎮 Launching Moonlight (native) for: ${appName}`);
          const moonlightCmd = `moonlight-qt stream localhost "${appName}" &`;
          executeMoonlight(moonlightCmd, appKey, socket, instanceId, rules);
          return;
        }
        
        // Moonlight not found
        console.error('❌ Moonlight not found');
        socket.emit("app:error", { 
          appKey, 
          instanceId, 
          error: "Moonlight Qt not installed.\n\nInstall with:\nflatpak install --user flathub com.moonlight_stream.Moonlight\n\nThen pair with Sunshine at:\nhttp://localhost:47990" 
        });
      });
    });
  });
}

function executeMoonlight(cmd, appKey, socket, instanceId, rules) {
  console.log(`🚀 Executing: ${cmd}`);
  
  const proc = exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error("❌ Moonlight launch error:", err);
      console.error("stderr:", stderr);
      
      let errorMsg = "Failed to launch Moonlight.";
      
      if (stderr.includes('Failed to connect') || stderr.includes('Connection refused')) {
        errorMsg = `Cannot connect to Sunshine server.\n\n1. Make sure Sunshine is running:\n   flatpak run dev.lizardbyte.app.Sunshine\n2. Check Sunshine web UI: http://localhost:47990\n3. Make sure the app "${rules.command}" is configured in Sunshine`;
      } else if (stderr.includes('not paired') || stderr.includes('pairing')) {
        errorMsg = `Moonlight not paired with Sunshine.\n\n1. Open Moonlight manually\n2. Add PC: localhost\n3. Enter PIN from Sunshine web UI (http://localhost:47990)`;
      }
      
      socket.emit("app:error", { 
        appKey, 
        instanceId, 
        error: errorMsg
      });
      return;
    }
  });

  // Store session
  nativeSessions.set(instanceId, {
    appKey,
    pid: proc.pid,
    type: "moonlight",
    display: "external",
    command: rules.command
  });

  // Notify client that Moonlight launched
  setTimeout(() => {
    console.log(`✅ Moonlight launched externally for ${rules.command}`);
    socket.emit("app:stream", {
      instanceId,
      appKey,
      type: "moonlight",
      external: true,
      message: `Moonlight Qt launched streaming "${rules.command}". Check your desktop for the Moonlight window.`
    });
  }, 1500);

  proc.on('exit', (code) => {
    console.log(`Moonlight process exited with code ${code}`);
    nativeSessions.delete(instanceId);
  });
}
// ==============================