const { app, BrowserWindow, ipcMain, Notification } = require("electron");
const path = require("path");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 540,
    resizable: false,
    title: "番茄钟",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on("show-notification", (_event, { title, body }) => {
  if (mainWindow && !mainWindow.isFocused()) {
    const notification = new Notification({ title, body });
    notification.on("click", () => {
      mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
  }
});
