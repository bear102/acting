# Starts backend (:8000) and frontend dev server (:5173). Ctrl+C stops the frontend; close the backend window.
$root = $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; ..\.venv\Scripts\uvicorn app:app --reload --port 8000"
Set-Location "$root\frontend"
npm run dev
