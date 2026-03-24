cd ~/punch-backend
 
# Install AWS SDK v3

npm install @aws-sdk/client-s3
 
# Replace index.js with new file

nano index.js

# paste entire content of ec2-backend-index.js → Ctrl+X → Y → Enter
 
# Restart

pm2 restart punch-backend

pm2 logs punch-backend --lines 10
 
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Punch Clock</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
 
<body>
<div id="root"></div>
</body>
</html>
 
