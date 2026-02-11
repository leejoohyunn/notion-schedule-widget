# Notion Weekly Schedule Widget

Notion에 임베드할 수 있는 주간 일정표 위젯입니다. Google Calendar와 양방향 동기화를 지원합니다.

## 데모

**배포 URL**: `https://leejoohyunn.github.io/notion-schedule-widget/`

Notion에서 `/embed` 블록으로 위 URL을 삽입하면 바로 사용할 수 있습니다.

## 주요 기능

### 일정 관리
- **24시간 주간 뷰** — 0:00~24:00 전체 시간대를 한눈에 확인
- **드래그 이동** — 일정 블록을 드래그하여 시간/요일 변경
- **리사이즈** — 일정 하단 핸들을 드래그하여 시간 길이 조절
- **더블클릭 수정** — 일정을 더블클릭하여 제목, 시간, 색상 수정
- **삭제** — 일정 위 × 버튼으로 삭제 (확인 다이얼로그 포함)
- **주간 네비게이션** — 이전/다음 주 탐색

### Google Calendar 연동
- **양방향 동기화** — 위젯에서 생성한 일정이 Google Calendar에도 자동 생성
- **색상 동기화** — Google Calendar의 11가지 색상과 위젯 색상이 일치
- **시간 일정 표시** — Google Calendar의 시간 일정을 그리드에 표시
- **종일 일정 표시** — 종일 일정은 요일 헤더에 뱃지로 표시
- **일정 수정/삭제** — Google Calendar 일정도 위젯에서 직접 수정 및 삭제 가능

### Notion 임베드 최적화
- **이메일 OTP 로그인** — iframe 환경에서 OAuth가 불가하므로 Supabase 이메일 인증 사용
- **커스텀 알림** — `alert()`, `confirm()` 대신 토스트 알림과 커스텀 모달 다이얼로그 사용
- **iframe 스토리지 대응** — localStorage 차단 시 in-memory 스토리지로 자동 폴백
- **고정 헤더** — 스크롤 시 요일/날짜 헤더가 상단에 고정
- **현재 시간선** — 오늘 날짜 컬럼에 현재 시간 표시

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | Vanilla JavaScript, HTML, CSS |
| 인증/DB | Supabase (이메일 OTP + PostgreSQL) |
| 캘린더 연동 | Google Apps Script (REST API 프록시) |
| 배포 | GitHub Pages |

## 프로젝트 구조

```
notion-schedule-widget/
├── index.html    # 메인 HTML (모달, 토스트 포함)
├── app.js        # 앱 로직 (인증, CRUD, 드래그, 캘린더 연동)
├── style.css     # 스타일 (그리드, 모달, 반응형)
└── README.md
```

## 설정 방법

### 1. Supabase 설정

1. [Supabase](https://supabase.com)에서 프로젝트 생성
2. `schedules` 테이블 생성:
   ```sql
   create table schedules (
     id uuid default gen_random_uuid() primary key,
     user_id uuid references auth.users(id),
     title text not null,
     date_key text not null,
     start_time text not null,
     end_time text not null,
     color text default '#039BE5'
   );
   ```
3. Authentication → Email OTP 활성화
4. Settings → Site URL을 배포 URL로 설정
5. `app.js`에 Supabase URL과 Anon Key 입력

### 2. Google Apps Script 설정

1. [Google Apps Script](https://script.google.com)에서 새 프로젝트 생성
2. 아래 코드를 붙여넣기:

   ```javascript
   function doGet(e) {
     var action = e.parameter.action;

     if (action === 'delete') {
       var cal = CalendarApp.getDefaultCalendar();
       var event = cal.getEventById(e.parameter.id);
       if (event) {
         event.deleteEvent();
         return ContentService.createTextOutput(JSON.stringify({success: true}))
           .setMimeType(ContentService.MimeType.JSON);
       }
       return ContentService.createTextOutput(JSON.stringify({success: false}))
         .setMimeType(ContentService.MimeType.JSON);
     }

     if (action === 'create') {
       var cal = CalendarApp.getDefaultCalendar();
       var startDt = new Date(e.parameter.date + 'T' + e.parameter.startTime + ':00');
       var endDt = new Date(e.parameter.date + 'T' + e.parameter.endTime + ':00');
       var newEvent = cal.createEvent(e.parameter.title, startDt, endDt);
       if (e.parameter.colorId) newEvent.setColor(e.parameter.colorId);
       return ContentService.createTextOutput(JSON.stringify({success: true, id: newEvent.getId()}))
         .setMimeType(ContentService.MimeType.JSON);
     }

     if (action === 'update') {
       var cal = CalendarApp.getDefaultCalendar();
       var event = cal.getEventById(e.parameter.id);
       if (event) {
         var startDt = new Date(e.parameter.date + 'T' + e.parameter.startTime + ':00');
         var endDt = new Date(e.parameter.date + 'T' + e.parameter.endTime + ':00');
         event.setTime(startDt, endDt);
         if (e.parameter.title) event.setTitle(e.parameter.title);
         if (e.parameter.colorId) event.setColor(e.parameter.colorId);
         return ContentService.createTextOutput(JSON.stringify({success: true}))
           .setMimeType(ContentService.MimeType.JSON);
       }
       return ContentService.createTextOutput(JSON.stringify({success: false}))
         .setMimeType(ContentService.MimeType.JSON);
     }

     var start = new Date(e.parameter.start);
     var end = new Date(e.parameter.end);
     var cal = CalendarApp.getDefaultCalendar();
     var events = cal.getEvents(start, end);

     var result = events.map(function(ev) {
       var startTime = ev.getStartTime();
       var endTime = ev.getEndTime();
       var allDay = ev.isAllDayEvent();
       return {
         id: ev.getId(),
         title: ev.getTitle(),
         date: Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
         startTime: allDay ? null : Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'HH:mm'),
         endTime: allDay ? null : Utilities.formatDate(endTime, Session.getScriptTimeZone(), 'HH:mm'),
         allDay: allDay,
         colorId: ev.getColor()
       };
     });

     return ContentService.createTextOutput(JSON.stringify(result))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ```

3. 배포 → 새 배포 → 웹 앱 (누구나 접근 가능) 선택
4. 생성된 URL을 `app.js`의 `GOOGLE_SCRIPT_URL`에 입력

### 3. 배포

```bash
git add -A
git commit -m "Initial deploy"
git push origin main
```

GitHub Pages가 `main` 브랜치에서 자동 배포됩니다.

## 색상 매핑

위젯과 Google Calendar의 색상이 동기화됩니다:

| 색상 | Hex | Google Calendar ID |
|------|-----|-------------------|
| Tomato | `#D50000` | 11 |
| Flamingo | `#E67C73` | 4 |
| Tangerine | `#F4511E` | 6 |
| Banana | `#F6BF26` | 5 |
| Sage | `#33B679` | 2 |
| Basil | `#0B8043` | 10 |
| Peacock | `#039BE5` | 7 |
| Blueberry | `#3F51B5` | 9 |
| Lavender | `#7986CB` | 1 |
| Grape | `#8E24AA` | 3 |
| Graphite | `#616161` | 8 |
