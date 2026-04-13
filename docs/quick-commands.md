## New Release

cd ~\Desktop\managr
git pull
npm run build:all
Remove-Item -Recurse -Force release
npx electron-builder --win nsis
