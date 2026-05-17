// ═════════════════════════════════════════════════════════════════════
//  番茄钟 — 渲染进程（计时器逻辑 + UI 控制）
//  负责：状态管理、倒计时运算、界面更新、通知触发、快捷键
// ═════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────
//  1. 配置区 — 所有可调参数集中在此
// ──────────────────────────────────────────────

const CONFIG = {
  workMinutes: 25,               // 专注时长（分钟）
  shortBreakMinutes: 5,          // 短休息时长（分钟）
  longBreakMinutes: 15,          // 长休息时长（分钟）
  sessionsBeforeLongBreak: 4,    // 每完成 N 个番茄，触发一次长休息
};

// ──────────────────────────────────────────────
//  2. DOM 引用 — 缓存所有需要操作的界面元素
//     避免每次更新时重复查询 DOM，提升性能
// ──────────────────────────────────────────────

const statusLabel = document.getElementById("statusLabel");     // 状态文字（"专注时间"/"短休息"等）
const timerDisplay = document.getElementById("timerDisplay");   // 倒计时数字（MM:SS）
const subText = document.getElementById("subText");             // 辅助文字（如 "已完成 3 个番茄"）
const ringProgress = document.getElementById("ringProgress");   // SVG 圆形进度弧
const btnPrimary = document.getElementById("btnPrimary");       // 主按钮（开始/暂停/继续）
const sessionCount = document.getElementById("sessionCount");   // 番茄计数显示

// ──────────────────────────────────────────────
//  3. SVG 环形进度条初始化
//     利用 stroke-dasharray / stroke-dashoffset 实现圆形进度效果
//     圆周长 = 2πr = 2 × π × 110 ≈ 691.15
// ──────────────────────────────────────────────

const CIRCUMFERENCE = 2 * Math.PI * 110;
ringProgress.style.strokeDasharray = CIRCUMFERENCE;   // 设定虚线的总长度 = 圆周长
ringProgress.style.strokeDashoffset = CIRCUMFERENCE;   // 初始偏移 = 周长，即进度为 0（完全隐藏）

// ──────────────────────────────────────────────
//  4. 状态变量
//     state:      idle（空闲）| working（专注）| shortBreak（短休息）| longBreak（长休息）
//     secondsLeft:  当前剩余秒数
//     totalSeconds: 当前阶段总秒数（用于计算进度百分比）
//     sessionCounter: 已完成的番茄钟数量
//     isRunning:     计时器是否正在走
//     endTime:       计时结束的绝对时间戳（epoch ms），用于防漂移计算
//     tickTimer:     setInterval 句柄
// ──────────────────────────────────────────────

let state = "idle";
let secondsLeft = 0;
let totalSeconds = CONFIG.workMinutes * 60;
let sessionCounter = 0;
let isRunning = false;
let endTime = 0;
let tickTimer = null;

// ──────────────────────────────────────────────
//  5. 核心计时函数
// ──────────────────────────────────────────────

/**
 * 启动计时器
 * @param {string} mode    - 工作模式: "working" | "shortBreak" | "longBreak"
 * @param {number} minutes - 该模式的时长（分钟）
 *
 * 工作原理：
 *   1. 记录当前状态和总时长
 *   2. 计算结束时间戳 endTime = 当前时间 + 总秒数 × 1000
 *      （基于绝对时间戳，后续 tick 通过 endTime - now 计算剩余，
 *        即使 setInterval 有延迟也不会累积误差 —— 防漂移）
 *   3. 更新界面：状态标签颜色、按钮文字、进度条颜色
 *   4. 启动 setInterval 每 200ms 执行一次 tick
 */
function startTimer(mode, minutes) {
  state = mode;
  totalSeconds = minutes * 60;
  secondsLeft = totalSeconds;
  endTime = Date.now() + secondsLeft * 1000;   // 设定绝对截止时间戳
  isRunning = true;

  // 根据模式设置状态文字
  const statusTexts = {
    working: "专注时间",
    shortBreak: "短休息",
    longBreak: "长休息",
  };

  statusLabel.textContent = statusTexts[mode];
  statusLabel.className = "status-label";
  statusLabel.classList.add(
    mode === "working" ? "active-work" : "active-break"   // 工作=红色，休息=绿色
  );

  // 进度条颜色切换：工作=红色(e94560)，休息=绿色(16c79a)
  ringProgress.classList.toggle("break-mode", mode !== "working");

  btnPrimary.textContent = "暂停";
  btnPrimary.classList.add("paused");    // paused 样式 = 深蓝色背景
  subText.textContent = "";
  subText.className = "sub-text";

  // 清除旧定时器再创建新定时器，防止重复启动导致多个 tick 并行
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 200);    // 200ms 刷新一次，UI 更新更平滑
}

/**
 * tick — 定时器每次触发执行
 *
 * 防漂移原理：
 *   - 不依赖 "每秒减 1"（那样会累积 setInterval 的延迟误差）
 *   - 每次用当前绝对时间与 endTime 求差，计算真实剩余秒数
 *   - 即使某次 tick 被延迟了 50ms，计算出的 secondsLeft 仍然是正确的
 */
function tick() {
  if (!isRunning) return;

  // 核心：用时间戳差值计算剩余秒数，而非简单递减
  secondsLeft = Math.max(0, Math.round((endTime - Date.now()) / 1000));
  updateDisplay();

  if (secondsLeft <= 0) {
    clearInterval(tickTimer);    // 倒计时结束，停止 tick
    onTimerComplete();           // 进入完成处理流程
  }
}

/**
 * 更新界面显示
 *   - 倒计时数字（MM:SS 格式）
 *   - SVG 环形进度条偏移量
 *
 *   progress = 剩余 / 总时长，范围 [0, 1]
 *   offset = 周长 × (1 - progress)
 *     当 progress=1（刚开始），offset=0，显示完整圆环
 *     当 progress=0（时间到），offset=周长，圆环完全消失
 */
function updateDisplay() {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  timerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  if (totalSeconds > 0) {
    const progress = secondsLeft / totalSeconds;
    const offset = CIRCUMFERENCE * (1 - progress);    // 偏移越大，可见弧越短
    ringProgress.style.strokeDashoffset = offset;
  }
}

// ──────────────────────────────────────────────
//  6. 按钮操作处理
// ──────────────────────────────────────────────

/**
 * 主按钮点击 / 空格键 统一入口
 *
 * 三种状态：
 *   idle（空闲）     → 开始工作计时
 *   running（运行中）→ 暂停（记录当前剩余时间）
 *   paused（已暂停） → 继续（重新计算 endTime）
 */
function handlePrimary() {
  if (state === "idle") {
    // 场景 1：从空闲启动工作计时
    startTimer("working", CONFIG.workMinutes);
  } else if (isRunning) {
    // 场景 2：运行中 → 暂停
    // 先捕获当前剩余时间（用 endTime - now），再停止定时器
    isRunning = false;
    secondsLeft = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    clearInterval(tickTimer);
    btnPrimary.textContent = "继续";
    btnPrimary.classList.remove("paused");
  } else {
    // 场景 3：暂停 → 继续
    // 基于当前剩余秒数重新计算新的 endTime
    endTime = Date.now() + secondsLeft * 1000;
    isRunning = true;
    btnPrimary.textContent = "暂停";
    btnPrimary.classList.add("paused");
    tickTimer = setInterval(tick, 200);
  }
}

/**
 * 重置 — 回到初始空闲状态
 *   - 停止计时器
 *   - 所有状态恢复到 idle
 *   - 显示 25:00，进度条满
 *   - 如果已有完成的番茄，显示 "已完成 N 个番茄"
 */
function handleReset() {
  isRunning = false;
  clearInterval(tickTimer);
  state = "idle";
  secondsLeft = 0;
  totalSeconds = CONFIG.workMinutes * 60;

  timerDisplay.textContent = "25:00";
  ringProgress.style.strokeDashoffset = CIRCUMFERENCE;    // 进度条重置为满
  ringProgress.classList.remove("break-mode");

  statusLabel.textContent = "准备开始";
  statusLabel.className = "status-label";

  btnPrimary.textContent = "开始";
  btnPrimary.classList.remove("paused");

  subText.textContent = "";
  subText.className = "sub-text";

  // 如果之前有完成记录，显示在辅助文字区
  if (sessionCounter > 0) {
    subText.textContent = `已完成 ${sessionCounter} 个番茄`;
    subText.className = "sub-text show";
  }
}

// ──────────────────────────────────────────────
//  7. 倒计时完成处理（核心状态流转）
// ──────────────────────────────────────────────

/**
 * 倒计时结束时调用
 *
 * 状态流转规则：
 *   working（工作完成）
 *     ├─ 第 4 个番茄 → longBreak（长休息 15min）
 *     └─ 其他        → shortBreak（短休息 5min）
 *   休息完成
 *     └─ 回到 idle（空闲），等待用户手动开始下一个番茄
 *
 * 设计要点：
 *   - 先通过 setTimeout 延迟执行，让系统通知先弹出
 *   - 工作完成时：递增计数、发通知、自动进入休息
 *   - 休息完成时：回到空闲状态
 */
function onTimerComplete() {
  // ── 工作完成 → 计数 + 通知 ──
  if (state === "working") {
    sessionCounter++;
    updateSessionCount();

    // 通过 preload 暴露的 electronAPI 调用主进程发系统通知
    // 只有当窗口未被聚焦时才会弹出（见 main.js 中的逻辑）
    window.electronAPI.showNotification(
      "番茄钟",
      `已完成第 ${sessionCounter} 个番茄！`
    );
  }

  // ── 决定下一个阶段 ──
  // 流转规则：
  //   working → shortBreak（前 3 次）或 longBreak（第 4 次）
  //   休息完成 → idle（回到空闲，等待手动开始）
  let nextMode = null; // [模式名, 分钟数] 或 null

  if (state === "working") {
    const isLong =
      sessionCounter % CONFIG.sessionsBeforeLongBreak === 0;
    if (isLong) {
      nextMode = ["longBreak", CONFIG.longBreakMinutes];
    } else {
      nextMode = ["shortBreak", CONFIG.shortBreakMinutes];
    }
  }

  // ── 延迟执行，让通知有时间送达 ──
  setTimeout(() => {
    if (nextMode) {
      // 自动进入休息阶段
      startTimer(nextMode[0], nextMode[1]);
    } else {
      // 休息结束 → 回到空闲
      state = "idle";
      btnPrimary.textContent = "开始";
      btnPrimary.classList.remove("paused");
      statusLabel.textContent = "休息结束，准备下一个番茄";
      statusLabel.className = "status-label";
      statusLabel.style.color = "#16c79a";
    }
  }, 300);

  // ── 请求浏览器通知权限（Electron 中也会用到） ──
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ──────────────────────────────────────────────
//  8. Session 计数更新
// ──────────────────────────────────────────────

function updateSessionCount() {
  sessionCount.textContent = `🍅 × ${sessionCounter}`;
}

// ──────────────────────────────────────────────
//  9. 键盘快捷键
//     Space → 开始/暂停（阻止页面滚动）
//     Esc   → 重置
// ──────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();    // 阻止空格触发表单滚动
    handlePrimary();
  } else if (e.code === "Escape") {
    handleReset();
  }
});

// ──────────────────────────────────────────────
//  10. 事件绑定
// ──────────────────────────────────────────────

btnPrimary.addEventListener("click", handlePrimary);
document.getElementById("btnReset").addEventListener("click", handleReset);
