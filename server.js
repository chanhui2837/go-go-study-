// 시험공부 문제집 서버 - Render + MongoDB (사회/국어)
// 실행: npm install 후 MONGODB_URI, JWT_SECRET 환경변수를 지정하고 node server.js
// 프론트(index.html, 단일파일)는 GET / 로 서빙. API는 /api/*
// Mongo 저장: users(계정+프로필+누적통계), scores(유저별 DAY 최고점+과목)
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES = "7d";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

// ---------- Mongo 모델 ----------
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, minlength: 3, maxlength: 20 },
    passwordHash: { type: String, required: true },
    displayName: { type: String, default: "", maxlength: 20 },
    avatar: { type: String, default: "🦊", maxlength: 8 },
    goal: { type: String, default: "", maxlength: 60 },
    photo: { type: String, default: "" },
    photoUpdatedAt: { type: Date, default: null },
    totalScore: { type: Number, default: 0 },
    completedCount: { type: Number, default: 0 },
    attemptsCount: { type: Number, default: 0 },
    lastActive: { type: Date, default: null }
  },
  { timestamps: true }
);
const scoreSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    dayId: { type: String, required: true },
    subject: { type: String, default: "society", index: true },
    best: { type: Number, required: true, min: 0, max: 100 },
    correct: { type: Number, default: 0 },
    attempts: { type: Number, default: 1 }
  },
  { timestamps: true }
);
scoreSchema.index({ userId: 1, dayId: 1 }, { unique: true });
const User = mongoose.model("User", userSchema);
const Score = mongoose.model("Score", scoreSchema);

let dbReady = false;
async function connectDB() {
  if (!MONGODB_URI) {
    console.log("[mongo] MONGODB_URI 없음 - 로컬 모드(정적 서빙만, API는 503)");
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI);
    dbReady = true;
    console.log("[mongo] 연결 성공");
  } catch (e) {
    console.error("[mongo] 연결 실패:", e.message);
  }
}
function needDB(req, res, next) {
  if (!dbReady) return res.status(503).json({ error: "DB 미연결(MONGODB_URI 확인)" });
  next();
}

// ---------- 인증 ----------
const USER_RE = /^[A-Za-z0-9가-힣_]{3,20}$/;
function signToken(user) {
  return jwt.sign({ uid: String(user._id), u: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: "로그인 필요" });
  try {
    req.me = jwt.verify(t, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "토큰 만료/무효 - 다시 로그인" });
  }
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

function publicUser(u) {
  return {
    username: u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar || "🦊",
    goal: u.goal || "",
    photo: u.photo || "",
    photoUpdatedAt: u.photoUpdatedAt || null,
    totalScore: u.totalScore || 0,
    completedCount: u.completedCount || 0,
    attemptsCount: u.attemptsCount || 0,
    lastActive: u.lastActive,
    createdAt: u.createdAt
  };
}

// 회원가입: 유저 정보 Mongo 저장 (비밀번호는 해시만 저장)
app.post("/api/auth/signup", authLimiter, needDB, async (req, res) => {
  try {
    const { username, password, displayName } = req.body || {};
    if (!username || !USER_RE.test(username)) return res.status(400).json({ error: "아이디는 3~20자(한글/영문/숫자/_)" });
    if (!password || String(password).length < 6) return res.status(400).json({ error: "비밀번호 6자 이상" });
    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ error: "이미 있는 아이디" });
    const passwordHash = await bcrypt.hash(String(password), 10);
    const u = await User.create({
      username,
      passwordHash,
      displayName: String(displayName || username).slice(0, 20),
      lastActive: new Date()
    });
    res.json({ token: signToken(u), user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ error: "가입 실패: " + e.message });
  }
});

// 로그인
app.post("/api/auth/login", authLimiter, needDB, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = await User.findOne({ username });
    if (!u) return res.status(401).json({ error: "아이디/비밀번호 확인" });
    const ok = await bcrypt.compare(String(password || ""), u.passwordHash);
    if (!ok) return res.status(401).json({ error: "아이디/비밀번호 확인" });
    u.lastActive = new Date();
    await u.save();
    res.json({ token: signToken(u), user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ error: "로그인 실패: " + e.message });
  }
});

// 내 정보
app.get("/api/me", needDB, auth, async (req, res) => {
  const u = await User.findById(req.me.uid);
  if (!u) return res.status(404).json({ error: "유저 없음" });
  const scores = await Score.find({ userId: u._id }).select("dayId subject best correct attempts updatedAt -_id");
  res.json({ user: publicUser(u), scores });
});

// 프로필 바꾸기 (표시이름/아바타/목표/사진)
app.put("/api/me", needDB, auth, async (req, res) => {
  try {
    const u = await User.findById(req.me.uid);
    if (!u) return res.status(404).json({ error: "유저 없음" });
    const { displayName, avatar, goal, photo } = req.body || {};
    if (displayName !== undefined) u.displayName = String(displayName).slice(0, 20) || u.username;
    if (avatar !== undefined) u.avatar = String(avatar).slice(0, 8) || "🦊";
    if (goal !== undefined) u.goal = String(goal).slice(0, 60);
    if (photo !== undefined) {
      const ps = String(photo || "");
      if (ps && (ps.length > 200000 || ps.indexOf("data:image/") !== 0)) return res.status(400).json({ error: "사진 형식이 잘못됐어요" });
      u.photo = ps;
      u.photoUpdatedAt = new Date();
    }
    await u.save();
    res.json({ user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ error: "프로필 저장 실패: " + e.message });
  }
});

// 점수 제출 (DAY 최고점 갱신 + 유저 누적통계 재계산)
app.post("/api/scores", needDB, auth, async (req, res) => {
  try {
    const { dayId, score, correct, subject } = req.body || {};
    if (!dayId || typeof dayId !== "string") return res.status(400).json({ error: "dayId 필요" });
    const subj = subject === "korean" ? "korean" : subject === "history" ? "history" : subject === "science" ? "science" : "society";
    const s = Math.max(0, Math.min(100, Number(score)));
    if (!Number.isFinite(s)) return res.status(400).json({ error: "score 0~100" });
    const r = await Score.findOneAndUpdate(
      { userId: req.me.uid, dayId },
      { $max: { best: s }, $inc: { attempts: 1 }, $set: { correct: Number(correct) || 0, subject: subj } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const agg = await Score.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.me.uid) } },
      { $group: { _id: null, total: { $sum: "$best" }, n: { $sum: 1 }, att: { $sum: "$attempts" } } }
    ]);
    const u = await User.findById(req.me.uid);
    if (u && agg[0]) {
      u.totalScore = agg[0].total;
      u.completedCount = agg[0].n;
      u.attemptsCount = agg[0].att;
      u.lastActive = new Date();
      await u.save();
    }
    res.json({ ok: true, best: r.best, attempts: r.attempts });
  } catch (e) {
    res.status(500).json({ error: "점수 저장 실패: " + e.message });
  }
});

// 내 점수 전체
app.get("/api/scores/me", needDB, auth, async (req, res) => {
  const list = await Score.find({ userId: req.me.uid }).select("dayId subject best correct attempts updatedAt -_id");
  res.json({ scores: list });
});

// 리더보드 (과목별 TOP 50: ?subject=all|society|korean|history|science)
app.get("/api/leaderboard", needDB, async (req, res) => {
  try {
    const q = req.query.subject;
    const f = q === "korean" ? "korean" : q === "history" ? "history" : q === "science" ? "science" : q === "society" ? "society" : "all";
    if (f === "all") {
      const top = await User.find({})
        .sort({ totalScore: -1, completedCount: -1, updatedAt: -1 })
        .limit(50)
        .select("username displayName avatar goal totalScore completedCount lastActive -_id")
        .lean();
      return res.json({ board: top.map((u) => ({ ...u, displayName: u.displayName || u.username })) });
    }
    const matchSubj = f === "society" ? { $or: [{ subject: "society" }, { subject: { $exists: false } }] } : { subject: f };
    const agg = await Score.aggregate([
      { $match: matchSubj },
      { $group: { _id: "$userId", total: { $sum: "$best" }, n: { $sum: 1 } } },
      { $sort: { total: -1, n: -1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "u"
        }
      },
      { $unwind: "$u" },
      {
        $project: {
          _id: 0,
          username: "$u.username",
          displayName: "$u.displayName",
          avatar: "$u.avatar",
          goal: "$u.goal",
          totalScore: "$total",
          completedCount: "$n",
          lastActive: "$u.lastActive"
        }
      }
    ]);
    res.json({ board: agg.map((u) => ({ ...u, displayName: u.displayName || u.username })) });
  } catch (e) {
    res.status(500).json({ error: "리더보드 실패: " + e.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, db: dbReady ? "connected" : "disconnected", time: new Date().toISOString() });
});

// 프론트 단일파일 서빙 (index.html만 노출)
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

connectDB().then(() => app.listen(PORT, () => console.log("[server] http://localhost:" + PORT)));
