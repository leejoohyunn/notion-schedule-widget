# Notion Weekly Schedule Widget

A weekly schedule widget that can be embedded in Notion. Supports two-way sync with Google Calendar.

**Live Demo**: `https://leejoohyunn.github.io/notion-schedule-widget/`

Embed this URL using the `/embed` block in Notion.

## How to Use (End Users)

### 1. Log in

- Open the widget and click the **Login** button
- Enter your email and submit
- Check your inbox for a 6-digit OTP code and enter it

### 2. Connect Google Calendar

1. Go to [Google Apps Script](https://script.google.com) and create a new project
2. Paste the following code:

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

3. Click **Deploy** > **New deployment** > Select **Web app**
4. Set "Who has access" to **Anyone**
5. Click **Deploy** and copy the generated URL
6. Back in the widget, click the **Settings** button (gear icon) and paste the URL > **Save**

Your Google Calendar events will now appear in the widget.

## Features

### Schedule Management
- **24-hour weekly view** — Full day view from 0:00 to 24:00
- **Drag to move** — Drag schedule blocks to change time or day
- **Resize** — Drag the bottom handle to adjust duration
- **Double-click to edit** — Edit title, time, and color
- **Delete** — Click the X button on hover or use the delete button in the edit modal
- **Overlapping events** — Multiple events at the same time are displayed side by side
- **Week navigation** — Browse previous/next weeks

### Google Calendar Sync
- **Two-way sync** — Events created in the widget are automatically added to Google Calendar
- **Color sync** — All 11 Google Calendar colors are supported
- **Timed events** — Displayed on the time grid
- **All-day events** — Shown as badges in the day header
- **Edit/Delete** — Google Calendar events can be modified directly in the widget
- **Deduplication** — Prevents duplicate display of synced events

### Optimized for Notion Embed
- **Email OTP login** — Uses Supabase email auth since OAuth is not available in iframes
- **Custom alerts** — Toast notifications and custom modal dialogs instead of `alert()`/`confirm()`
- **iframe storage fallback** — Automatic in-memory fallback when localStorage is blocked
- **Sticky headers** — Day/date headers stay fixed while scrolling
- **Current time indicator** — Red line showing current time on today's column

## Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend | Vanilla JavaScript, HTML, CSS |
| Auth/DB | Supabase (Email OTP + PostgreSQL) |
| Calendar | Google Apps Script (REST API proxy) |
| Hosting | GitHub Pages |

## Self-Hosting Guide

If you want to fork and deploy your own instance:

### 1. Supabase Setup

1. Create a project at [Supabase](https://supabase.com)
2. Create the `schedules` table:
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
3. Create the `user_settings` table (per-user Google Calendar support):
   ```sql
   create table user_settings (
     user_id uuid references auth.users(id) primary key,
     google_script_url text
   );
   alter table user_settings enable row level security;
   create policy "Users can read own settings" on user_settings for select using (auth.uid() = user_id);
   create policy "Users can insert own settings" on user_settings for insert with check (auth.uid() = user_id);
   create policy "Users can update own settings" on user_settings for update using (auth.uid() = user_id);
   ```
4. Go to **Authentication** > **Providers** > **Email** and enable OTP
5. Set the **Site URL** to your deployment URL
6. Update `app.js` with your Supabase URL and Anon Key

### 2. Deploy

```bash
git add -A
git commit -m "Initial deploy"
git push origin main
```

Enable GitHub Pages from the `main` branch in your repository settings.

## Project Structure

```
notion-schedule-widget/
├── index.html    # Main HTML (modals, toast)
├── app.js        # App logic (auth, CRUD, drag, calendar sync)
├── style.css     # Styles (grid, modals, responsive)
└── README.md
```

## Color Mapping

Widget colors are synced with Google Calendar:

| Color | Hex | Google Calendar ID |
|-------|-----|-------------------|
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
