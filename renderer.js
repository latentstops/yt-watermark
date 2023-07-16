const fs = require('fs');
const path = require('path');
const util = require('util');
const {https} = require('follow-redirects');
const sanitize = require('sanitize-filename');
const ncp = require('node-clipboardy');
const isUrl = require('is-url');
const extractZip = require('extract-zip');
const {shell} = require('electron');
const os = require('os');

const exec = util.promisify(require('child_process').exec);

const OS_PLATFORM = os.platform();
const OS_PLATFORM_IS_WIN = OS_PLATFORM === "win32";
const OS_PLATFORM_IS_DARWIN = OS_PLATFORM === "darwin";
const OS_PLATFORM_IS_LINUX = OS_PLATFORM === "linux";
const OS_PLATFORM_IS_WIN_OR_LINUX = OS_PLATFORM_IS_WIN || OS_PLATFORM_IS_LINUX;
const OS_PLATFORM_IS_WIN_OR_DARWIN = OS_PLATFORM_IS_WIN || OS_PLATFORM_IS_DARWIN;

const options = { recursive: true };
const BIN = path.resolve( __dirname, 'bin');
const WORKSPACE = path.resolve(__dirname, 'workspace');
const DIST_WORKSPACE_VIDEOS = path.resolve(WORKSPACE, 'videos');
const DIST_WORKSPACE_WATERMARKS = path.resolve(WORKSPACE, 'watermarks');

fs.mkdirSync(BIN, options);
fs.mkdirSync(WORKSPACE, options);
fs.mkdirSync(DIST_WORKSPACE_VIDEOS, options);
fs.mkdirSync(DIST_WORKSPACE_WATERMARKS, options);

const CLI_DIRNAME = `bin`;
const CLI_DIR_PATH = path.resolve(__dirname, CLI_DIRNAME);
const WORKSPACE_DIRNAME = `workspace`;
const WORKSPACE_DIR_PATH = path.resolve(__dirname, WORKSPACE_DIRNAME);
const WATERMARKS_DIR_PATH = path.resolve(WORKSPACE_DIR_PATH, 'watermarks');
const VIDEOS_DIR_PATH = path.resolve(WORKSPACE_DIR_PATH, 'videos');

const POSTFIX = OS_PLATFORM_IS_WIN ? ".exe" : "";
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp${POSTFIX}`;
const YTDLP_FILENAME = last(YTDLP_URL);
const YTDLP_PATH = path.resolve(CLI_DIR_PATH, YTDLP_FILENAME);

const FFMPEG_URL_PART_PLATFORM_MAP = {
    win32: "win" + os.arch().replace('x',''),
    linux: "linux" + os.arch().replace('x',''),
};
const FFMPEG_ZIP_URL_OS_ARCH = FFMPEG_URL_PART_PLATFORM_MAP[OS_PLATFORM];
const FFMPEG_URL_ARCHIVE_FILE_EXTENSION = OS_PLATFORM_IS_WIN ? `.zip` : '.tar.xz';
const FFMPEG_URL_ARCHIVE_FILE_NAME = `${FFMPEG_ZIP_URL_OS_ARCH}-gpl${FFMPEG_URL_ARCHIVE_FILE_EXTENSION}`;
const FFMPEG_ZIP_URL_WIN_AND_LINUX = `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${FFMPEG_URL_ARCHIVE_FILE_NAME}`;
const FFMPEG_ZIP_URL_MACOS = "https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip";
const FFMPEG_URL_PLATFORM_MAP = {
    win32: FFMPEG_ZIP_URL_WIN_AND_LINUX,
    linux: FFMPEG_ZIP_URL_WIN_AND_LINUX,
    darwin: FFMPEG_ZIP_URL_MACOS
};
const FFMPEG_ZIP_URL = FFMPEG_URL_PLATFORM_MAP[OS_PLATFORM];
const FFMPEG_ZIP_FILENAME = last(FFMPEG_ZIP_URL);
const FFMPEG_ZIP_FILEPATH = path.resolve(CLI_DIR_PATH, FFMPEG_ZIP_FILENAME);
const FFMPEG_DIR_PATH = path.resolve(CLI_DIR_PATH, lastDir(FFMPEG_ZIP_FILENAME), 'bin');
const FFMPEG_PATH = path.resolve(OS_PLATFORM_IS_WIN_OR_LINUX ? FFMPEG_DIR_PATH : CLI_DIR_PATH, `ffmpeg${POSTFIX}`);

const PARAMS = ['url', 'gap', 'scale', 'watermark'];
const DEFAULTS = { gap: '0.1', scale: '0.1' };
const VIDEO_FORMAT = 'mp4';

const ffmpeg = createCli(FFMPEG_PATH);
const ytdlp = createCli(YTDLP_PATH);

(async function start() {
    await setupCLIs();
    setupUserParams();
    setupWatermarks();
    window.loading.remove();
})();

async function go(e){
    e.preventDefault();
    try {
        setInfo();

        let {url, gap, scale, watermark} = processParams();

        const watermarkFilePath = processWatermarkFile(window["watermark_file"]);
        const watermarkSelectPath = path.resolve(WATERMARKS_DIR_PATH, watermark);

        watermark = watermarkFilePath || watermarkSelectPath;

        await applyWatermark({url, gap, scale, watermark});
    } catch (e){
        alert(e.message);
    }

    return false;
}

function processWatermarkFile(fileInput){
    const fromPath = fileInput.files[0]?.path;

    if( !fromPath ) return false;

    const fileName = last(fromPath);
    const fileNameSafe = sanitize(fileName);
    const toPath = path.resolve(WATERMARKS_DIR_PATH, fileNameSafe);

    fs.copyFileSync(fromPath, toPath);

    setupWatermarks();

    return toPath;
}

async function applyWatermark({url, watermark, gap, scale}) {
    setInfo('Extracting video file name -> ');
    const ytdlpCommandArgs = `-S res,ext:${VIDEO_FORMAT}:m4a --recode ${VIDEO_FORMAT} --restrict-filenames --print filename ${url}`;
    const baseFileName = await ytdlp(ytdlpCommandArgs).then(sanitize).then(getBaseFileName);
    const fileName = `${baseFileName}.${VIDEO_FORMAT}`;
    const filePath = path.resolve(VIDEOS_DIR_PATH, fileName);

    setFileName(`File name: ${fileName} `);

    const waterMarkedFileName = `WM_${fileName}`;
    const waterMarkedFilePath = path.resolve(VIDEOS_DIR_PATH,waterMarkedFileName);

    appendInfo('Downloading video -> ');
    await ytdlp(`-S res,ext:mp4:m4a --recode mp4 --restrict-filenames ${url} -o ${filePath}`);

    appendInfo('Applying watermark -> ');
    await ffmpeg(`-y -i ${filePath} -i ${watermark} -filter_complex "[1][0]scale2ref=w=oh*mdar:h=ih*${scale}[logo][video];[video][logo]overlay=W-w-w*${gap}:H-h-h*${gap}" -preset ultrafast -async 1 -codec:a copy ${waterMarkedFilePath}`)

    appendInfo('Done');
}

function createCli(path){
    return async function cli() {
        const args = [...arguments].join(' ');
        return await exec(`${path} ${args}`).then( ({stdout, stderr}) => (stdout || stderr) );
    }
}

async function setupCLIs(){
    await downloadAsCliIfNot(YTDLP_URL);
    await downloadAsCliIfNot(FFMPEG_ZIP_URL);

    if(fs.existsSync(FFMPEG_PATH)) return;

    await extractArchive(FFMPEG_ZIP_FILEPATH, { dir: CLI_DIR_PATH });
}

async function downloadAsCliIfNot(url){
    const fileName = path.resolve( CLI_DIR_PATH, last(url) );

    await downloadIfNot(url, fileName);

    if(!OS_PLATFORM_IS_WIN){
        return exec(`chmod a+rx ${fileName}`);
    }
}

function downloadIfNot(url, filName = last(url)){
    if(isUrlDownloaded(url, filName)) return;

    return download(url, filName);
}

function download(url, fileName = last(url)){
    const file = fs.createWriteStream(fileName);

    return new Promise((resolve, reject) => {
        https.get(url, response => {
            response.pipe(file);
            file.on("finish", () => {
                file.close();
                resolve(file);
            });
            file.on('error', reject);
        }, reject);
    })
}

function isUrlDownloaded(url, filName = last(url)){
    const filePath = path.resolve(CLI_DIR_PATH, filName);

    return fs.existsSync(filePath)
}

function lastDir(path){
    const name = last(path);
    return name.split('.')[0];
}

function last(path){
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1];
}

function processParams(){
    keepUserParams();
    return getUserParams();
}

function setupWatermarks(){
    let selectedIndex;
    const {watermark} = window;

    watermark.innerHTML = '';

    fs.readdirSync(WATERMARKS_DIR_PATH).forEach((fileName, index) => {
        if(fileName === localStorage.watermark) selectedIndex = index;

        watermark.appendChild(c('option', {value: fileName, innerHTML: fileName}));
    });

    watermark.selectedIndex = selectedIndex;
    watermark.onchange = keepUserParams;
}

function setupUserParams(){
    PARAMS.forEach(param => window[param].value = localStorage[param] || DEFAULTS[param] || '');
}

function keepUserParams(){
    Object.assign(localStorage, getUserParams());
}

function getUserParams(){
    return PARAMS.reduce((acc, param) => (acc[param] = window[param].value, acc), {});
}

function c(tag, options){
    return Object.assign(document.createElement(tag), options);
}

function openWorkspace(){
    return shell.openPath(WORKSPACE_DIR_PATH);
}

function reload(){
    location.reload();
}

function setInfo(txt = ''){
    window.info.innerHTML = txt;
}

function appendInfo(txt){
    window.info.innerHTML += `${txt}\n`;
}

function setFileName(name){
    window.filename.innerHTML = name;
}

function pasteIfUrl(){
    try{
        const data = ncp.readSync();

        if( isUrl( data ) ) window.url.value = data;
    } catch (e){
        console.log(e.message);
    }
}
function getBaseFileName(fileName){
    return fileName.substring(0, fileName.indexOf(path.extname(fileName)));
}

function extractArchive(fileName, { dir }){
    if(OS_PLATFORM_IS_WIN_OR_DARWIN) return extractZip(...arguments);
    else return exec(`tar -xvf ${fileName} -C ${dir}`);
}

module.exports = {
    go,
    reload,
    pasteIfUrl,
    openWorkspace,
    keepUserParams
};