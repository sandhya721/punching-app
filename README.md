# Punching App

Employee Attendance Punch In/Out Application

## Tech Stack
- Backend  : Node.js + Express
- Database : MongoDB (Mongoose)
- Frontend : Vanilla HTML/CSS/JS

## Project Structure

```
punching-app/
├── backend/
│   └── server.js
├── frontend/
│   └── index.html
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Local Setup

1. Install dependencies
   npm install

2. Create .env file
   cp .env.example .env
   Then edit .env and add your MongoDB URI

3. Run the app
   npm start          (production)
   npm run dev        (development with auto-reload)

4. Open browser
   http://localhost:3000

## Deploy on Render

- Build Command : npm install
- Start Command : node backend/server.js
- Environment Variables:
    MONGO_URI = your mongodb connection string
    PORT      = 3000

## API Endpoints

POST   /api/punch-in            Punch in an employee
POST   /api/punch-out           Punch out an employee
GET    /api/records             Get all records
GET    /api/records?employeeId= Filter by employee
GET    /api/records?date=       Filter by date
GET    /api/status/:employeeId  Get current status
GET    /api/summary             Today summary
DELETE /api/records/:id         Delete a record
