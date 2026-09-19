# Render + MongoDB 배포 가이드

이 폴더가 그대로 하나의 웹 서비스가 됩니다.
프론트(`index.html`, 사회 48 DAY + 국어 36 DAY + 한국사 90 DAY = 174 DAY·4350문제 단일파일)는 `GET /` 로 서빙되고,
로그인·프로필·점수·리더보드(전체/사회/국어/한국사 탭)는 `/api/*` + MongoDB에 저장됩니다.

## 0. 사용 흐름
시작하기 → 과목 선택(📖 사회 통합사회2 / 📝 국어 공통국어2 / 🏛️ 한국사 한국사2) → 대단원·난이도 선택 → DAY 풀이(25문제, 제출 후 채점·분석)
- 사회: 5개 대단원 × 중단원 수 = 난이도별 16 DAY (기본/실력/최상)
- 국어(미래엔 공통국어2): 1.한국 문학의 길(4) 2.문제 해결의 지혜(2) 3.국어의 어제와 오늘(2) 4.세상을 보는 눈(2) 5.소통하고 참여하라(2) = 난이도별 12 DAY
- 한국사(해냄에듀 한국사2): 1.식민 통치와 민족 운동(11) 2.대한민국의 발전(12) 3.오늘날의 대한민국(7) = 난이도별 30 DAY

## 1. MongoDB Atlas 준비 (5분)
1. https://cloud.mongodb.com 가입 → 무료(M0) 클러스터 생성
2. Database Access → 유저 생성 (아이디/비밀번호 메모)
3. Network Access → `0.0.0.0/0` 허용 (Render에서 접속해야 해서 필요)
4. Databases → Connect → Drivers → 연결 URI 복사
   예: `mongodb+srv://myuser:mypass@cluster0.abcd.mongodb.net/sahoe?retryWrites=true&w=majority`
   (`sahoe` 부분이 DB 이름. 없으면 자동 생성됨)

## 2. Render 배포
방법 A (GitHub 연결, 권장):
1. 이 폴더 내용을 GitHub 새 리포지토리에 푸시 (`index.html`, `server.js`, `package.json`, `render.yaml` 포함)
2. https://dashboard.render.com → New → Web Service → 해당 리포 연결
3. Build Command: `npm install`, Start Command: `node server.js` (render.yaml이 있으면 자동)
4. Environment 변수 2개 등록:
   - `MONGODB_URI` = 위 Atlas URI
   - `JWT_SECRET` = 아무 긴 문자열 (Generate 클릭)
5. Deploy → 발급된 `https://xxx.onrender.com` 접속 → 회원가입

방법 B (파일 직접 업로드형 서비스 이용 시): 위 4개 파일을 그대로 업로드하고 환경변수 동일하게 설정.

## 3. 동작 확인
- `https://xxx.onrender.com/api/health` → `{"ok":true,"db":"connected"}` 여야 정상
- `db:disconnected`면 `MONGODB_URI` 오타/IP허용(0.0.0.0/0)/Atlas 유저 권한 확인

## 4. 로컬 실행
```
npm install
# .env.example을 .env로 복사 후 MONGODB_URI, JWT_SECRET 입력
node server.js   # http://localhost:3000
```
`.env` 없이도 실행은 되지만 API는 503(DB 미연결), 문제풀이·로컬 기록은 정상 동작합니다.

## 5. 데이터 구조 (Mongo)
- `users`: username(유니크), passwordHash(해시만 저장), displayName, avatar, goal, totalScore, completedCount, attemptsCount
- `scores`: (userId, dayId) 유니크, best(DAY 최고점), correct, attempts
- 리더보드: `users`를 totalScore 내림차순 TOP 50
