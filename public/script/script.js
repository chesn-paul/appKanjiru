// Variables globales pour les flux média et l'enregistrement
let medias = [];
let render = [];
let recordedChunks = [];
let previewRecorder;
let startTime;
let timerInterval;
let elapsedTime = 0;
let isPaused = false;
let uniqueKey = generateUniqueKey();
let screenWidth;
let screenHeight;
let url;
let btnVideo = false;
let btnAudio = false;
let btnScreen = false;
let saved = false;
let end;
let paid = false;
let user;
let limit;
let browser = detectBrowser();

const canvas = document.getElementById("canvas");
const preview = document.getElementById("videoRecorded");

let screenSettings = null;
let previewScreen;
let previewWebcam;

const webcamVideo = document.createElement("video");
const screenVideo = document.createElement("video");

class mediaFlux {
  recorder = null;
  chunk = [];
  stream = null;
  setting = null;
  rec = false;

  constructor(type, codec, name) {
    this.type = type;
    this.codec = codec;
    this.name = uniqueKey + "_" + name;
  }

  setStream(stream) {
    this.stream = stream;
  }

  setRatio() {
    this.setting = this.stream.getVideoTracks()[0].getSettings().aspectRatio;
  }

  setRecorder(stream) {
    let mimeType = `${this.type}; ${this.codec}`;

    if (browser === "Safari") {
      if (this.type.startsWith("video")) {
        mimeType = "video/mp4";
      } else if (this.type.startsWith("audio")) {
        mimeType = "audio/mp4";
      }
    }

    this.recorder = new MediaRecorder(stream, { mimeType: mimeType });
    this.recorder.start();
  }

  stopRecorder() {
    return new Promise((resolve) => {
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunk.push(event.data);
        }
      };

      this.recorder.onstop = async () => {
        await saveTracks(this);
        resolve();
      };

      this.recorder.stop();
    });
  }
}

class videoSize {
  constructor(dx, dy, dw, dh) {
    this.x = dx;
    this.y = dy;
    this.w = dw;
    this.h = dh;
  }
}

var audio = new mediaFlux("audio/webm", "codecs=opus", "audio");
var webcam = new mediaFlux("video/webm", "codecs=vp8", "webcam");
var screen = new mediaFlux("video/webm", "codecs=vp8", "video");

function sizer(videoSettings) {
  if (videoSettings < canvas.width / canvas.height) {
    dh = canvas.height;
    dw = videoSettings * canvas.height;
    dx = (canvas.width - dw) / 2;
    dy = 0;
  } else {
    dh = canvas.width / videoSettings;
    dw = canvas.width;
    dx = 0;
    dy = (canvas.height - dh) / 2;
  }
  const positioner = new videoSize(dx, dy, dw, dh);
  return positioner;
}

function paint() {
  const FPS = 30;
  let myTimeout;
  let ctx = canvas.getContext("2d");

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#87bee866";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!screen.stream) {
      if (webcam.stream) {
        ctx.drawImage(
          webcamVideo,
          previewWebcam.x,
          previewWebcam.y,
          previewWebcam.w,
          previewWebcam.h
        );
      }
    } else {
      ctx.drawImage(
        screenVideo,
        previewScreen.x,
        previewScreen.y,
        previewScreen.w,
        previewScreen.h
      );
      if (webcam.stream) {
        ctx.drawImage(
          webcamVideo,
          canvas.width - 129,
          previewScreen.y + 4,
          125,
          125 / webcam.setting
        );
      }
    }

    myTimeout = setTimeout(draw, 1000 / FPS);
  }

  myTimeout = setTimeout(draw, 1000 / FPS);
}

paint();

window.addEventListener("message", function (event) {
  const data = event.data;
  user = data.userId;
  if (data.isSub == "active") {
    paid = true;
  }
  document.getElementById("user").textContent = data.userId;
  document.getElementById("admin").textContent = data.isSub;
});

// Récupère les dispositifs médias disponibles (caméras, micros, etc.)
navigator.mediaDevices.enumerateDevices().then((devices) => {
  const videoSelect = document.getElementById("videoSelect");
  const audioSelect = document.getElementById("audioSelect");

  devices.forEach((device) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.text = device.label || `${device.kind} ${device.deviceId}`;

    if (device.kind === "videoinput") {
      videoSelect.appendChild(option);
    } else if (device.kind === "audioinput") {
      audioSelect.appendChild(option);
    }
  });
});
////////////////////////////////////////////////////////////////////////
// Gestion du basculement de la caméra
document
  .getElementById("toggleVideo")
  .addEventListener("click", async (event) => {
    btnVideo = !btnVideo;
    const videoSelect = document.getElementById("videoSelect");
    videoSelect.style.display = btnVideo ? "inline" : "none";

    if (btnVideo) {
      try {
        webcam.setStream(
          await navigator.mediaDevices.getUserMedia({
            video: {
              frameRate: 15,
              width: { ideal: 150, max: 150 },
            },
          })
        );

        document.getElementById("toggleVideo").style.backgroundImage =
          "url('../ressource/bx-video-recording.png')";
        webcamVideo.style.display = "block";
        webcamVideo.srcObject = webcam.stream;
        webcamVideo.play();
        webcam.setRatio();
        previewWebcam = sizer(webcam.setting);
        webcam.rec = true;
      } catch (err) {
        console.error("Error accessing video stream:", err);
        alert("Erreur d'accès à la caméra : " + err.message);
      }
    } else {
      if (webcam.stream) {
        webcam.stream.getTracks().forEach((track) => track.stop());
        webcam.stream = null;
        webcam.rec = false;
      }
      document.getElementById("toggleVideo").style.backgroundImage =
        "url('../ressource/bx-video-recording-cross.png')";
      webcamVideo.style.display = "none";
    }
    toggleStartRecordingButton();
  });

// Gestion du basculement du micro
document
  .getElementById("toggleAudio")
  .addEventListener("click", async (event) => {
    btnAudio = !btnAudio;
    const audioSelect = document.getElementById("audioSelect");
    audioSelect.style.display = btnAudio ? "inline" : "none";

    if (btnAudio) {
      try {
        audio.setStream(
          await navigator.mediaDevices.getUserMedia({ audio: true })
        );
        document.getElementById("toggleAudio").style.backgroundImage =
          "url('../ressource/bx-microphone.png')";
        audio.rec = true;
      } catch (err) {
        console.error("Error accessing audio stream:", err);
        alert("Erreur d'accès au micro : " + err.message);
      }
    } else {
      if (audio.stream) {
        audio.stream.getTracks().forEach((track) => track.stop());
        document.getElementById("toggleAudio").style.backgroundImage =
          "url('../ressource/bx-microphone-cross.png')";
        audio.rec = false;
      }
    }
    toggleStartRecordingButton();
  });

// Gestion du basculement du partage d'écran
document
  .getElementById("toggleScreen")
  .addEventListener("click", async (event) => {
    btnScreen = !btnScreen;
    if (btnScreen) {
      try {
        screen.setStream(
          await navigator.mediaDevices.getDisplayMedia({
            video: {
              cursor: "always",
              frameRate: 15,
              width: { ideal: 1280, max: 1280 },
              height: { ideal: 720, max: 720 },
            },
          })
        );
        screenVideo.srcObject = screen.stream;
        screenVideo.onloadedmetadata = () => {
          screenWidth = screenVideo.videoWidth;
          screenHeight = screenVideo.videoHeight;
        };
        if (
          screen.stream.getVideoTracks()[0].getSettings().displaySurface ===
          "browser"
        ) {
          screenSettings = window.innerWidth / window.innerHeight;
        } else {
          screen.setRatio();
          screenSettings = screen.setting;
        }
        screenVideo.play();
        previewScreen = sizer(screenSettings);
        document.getElementById("toggleScreen").style.backgroundImage =
          "url('../ressource/bx-export.png')";
        screen.rec = true;
      } catch (err) {
        console.error("Error accessing screen stream:", err);
        alert("Erreur de partage d'écran : " + err.message);
      }
    } else {
      if (screen.stream) {
        screen.stream.getTracks().forEach((track) => track.stop());
        screen.stream = null;
        document.getElementById("toggleScreen").style.backgroundImage =
          "url('../ressource/bx-export-cross.png')";
        screen.rec = false;
      }
      screenVideo.srcObject = null;
    }
    toggleStartRecordingButton();
  });

// Active ou désactive le bouton de démarrage de l'enregistrement en fonction des options sélectionnées
function toggleStartRecordingButton() {
  const isAnyOptionEnabled = btnVideo || btnAudio || btnScreen;
  document.getElementById("startRecording").style.display = isAnyOptionEnabled
    ? "inline"
    : "none";
}

// Démarre l'enregistrement
document.getElementById("startRecording").addEventListener("click", () => {
  document.getElementById("message").textContent = " ";

  [audio, screen, webcam].forEach((item) => {
    if (item.rec) {
      medias.push(item);
    }
    render.push(item.rec);
  });

  medias.forEach((item) => {
    item.setRecorder(item.stream);
  });

  if (render[0]) {
    limit = 1041000;
  }

  if (render[1] || render[2]) {
    limit = 436000;
  }

  if (render[1] && render[2]) {
    limit = 298000;
  }

  if (screen.rec || webcam.rec) {
    const canvaStream = canvas.captureStream();

    const tracks = [];
    tracks.push(...canvaStream.getTracks());
    if (audio.rec) tracks.push(...audio.stream.getTracks());

    const combinedStream = new MediaStream(tracks);

    startRecording(combinedStream);
  } else {
    canvas.style.display = "none";
    document.getElementById("toggleVideo").style.display = "none";
    document.getElementById("toggleScreen").style.display = "none";
    document.getElementById("audioGif").style.display = "block";
  }

  startTimer();
  document.getElementById("toggleVideo").disabled = true;
  document.getElementById("toggleAudio").disabled = true;
  document.getElementById("toggleScreen").disabled = true;
  document.getElementById("startRecording").style.display = "none";
  if (paid) {
    document.getElementById("pauseResumeRecording").style.display = "inline";
  }
  document.getElementById("stopRecording").style.display = "inline";
});

// Met en pause ou reprend l'enregistrement
document
  .getElementById("pauseResumeRecording")
  .addEventListener("click", () => {
    if (isPaused) {
      previewRecorder.resume();
      medias.forEach((item) => {
        item.recorder.resume();
      });
      document.getElementById("pauseResumeRecording").style.backgroundImage =
        "url('../ressource/bx-pause.png')";
      startTimer();
    } else {
      previewRecorder.pause();
      medias.forEach((item) => {
        item.recorder.pause();
      });
      document.getElementById("pauseResumeRecording").style.backgroundImage =
        "url('../ressource/bxs-right-arrow.png')";
      pauseTimer();
    }
    isPaused = !isPaused;
  });

// Arrête l'enregistrement
document.getElementById("stopRecording").addEventListener("click", () => {
  stopRecording();
  stopTimer();
  document.getElementById("stopRecording").style.display = "none";
  document.getElementById("pauseResumeRecording").style.display = "none";
  document.getElementById("webcam").style.display = "none";
  document.getElementById("audio").style.display = "none";
  document.getElementById("screen").style.display = "none";
});

window.addEventListener("beforeunload", function (event) {
  if (!saved) {
    deleteLastFile(uniqueKey);
  }
});

document.getElementById("speedVideo").addEventListener("click", () => {
  document.getElementById("speedVideo").style.display = "none";
  document.getElementById("speedControl").style.display = "block";
});

// Télécharge la vidéo enregistrée
document.getElementById("downloadVideo").addEventListener("click", () => {
  downloadVideo(uniqueKey);
});

// Met à jour la valeur de la vitesse de lecture affichée
document.getElementById("playbackRate").addEventListener("change", (event) => {
  applyPlaybackRate(uniqueKey);
});

document.getElementById("playbackRate").addEventListener("input", (event) => {
  document.getElementById("playbackRateValue").textContent = event.target.value;
});

// Lance la retranscription de la vidéo enregistrée
document.getElementById("transcriptionVideo").addEventListener("click", () => {
  transcribeVideo(uniqueKey);
});

// Lance le sous-titrage de la vidéo enregistrée
document.getElementById("subtitles").addEventListener("click", () => {
  subtitleVideo(uniqueKey);
});

// Affiche un disclaimer pour les utilisateurs Safari et Firefox
if (browser === "Safari" || browser === "Firefox") {
  const disclaimer = document.getElementById("disclaimerBrowser");
  disclaimer.style.display = "inline";

  setTimeout(() => {
    disclaimer.style.display = "none";
  }, 7000);
}

// Génère un lien de partage pour la vidéo enregistrée
document
  .getElementById("generateShareLink")
  .addEventListener("click", async () => {
    document.getElementById("generateShareLink").style.display = "none";
    document.getElementById(
      "link"
    ).value = `https://app.kanjiru.co/sharelink/${uniqueKey}`;
    document.getElementById("copyLink").style.display = "flex";
    document.getElementById("copy").addEventListener("click", function () {
      this.textContent = "Lien copié !";
    });
  });

// Sauvegarde les fichier dans le Space DO
document.getElementById("saveFiles").addEventListener("click", async () => {
  if (paid === true) {
    document.getElementById("modal").style.display = "flex";
    document.getElementById("modal-text").textContent =
      "Vous ne pourrez plus modifier la vidéo aprés l'avoir sauvegardée !";
    document.getElementById("saveFiles").style.display = "none";
    document
      .getElementById("validModal")
      .addEventListener("click", async () => {
        saveRecordedVideo(uniqueKey);
      });
  } else {
    saveRecordedVideo(uniqueKey);
  }
});

document.getElementById("limit").addEventListener("click", async () => {
  document.getElementById("modal").style.display = "none";
});

document.getElementById("return").addEventListener("click", async () => {
  document.getElementById("modal").style.display = "none";
  document.getElementById("saveFiles").style.display = "flex";
});

async function saveTracks(item) {
  console.log(item.name);
  const blob = new Blob(item.chunk, { type: item.type });
  const file = new File([blob], `${item.name}.webm`, { type: item.type });
  const formData = new FormData();
  formData.append("file", file);
  try {
    const response = await fetch(`/tracks`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Failed to save ${item.name}`);
    }
    const rep = await response.text();
    console.log(rep);
  } catch (error) {
    console.log(error);
  }
}

async function renderVideo(key) {
  document.getElementById("loader").style.display = "block";
  document.getElementById("message").textContent = "Traitement du média...";

  const webRatio = webcam.setting;

  try {
    const response = await fetch(`/render/${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ render, screenWidth, screenHeight, webRatio }),
    });
    if (!response.ok) {
      throw new Error(`Rendering failed.`);
    }
    document.getElementById("loader").style.display = "none";
    document.getElementById("message").textContent = " ";
    document.getElementById("saveFiles").style.display = "inline";
    document.getElementById("flag").textContent = "Version finale";
    document.getElementById("flag").style.backgroundColor = "#00dd4ae3";

    if (screen.rec || webcam.rec) {
      preview.srcObject = null;
      preview.src = `./common/media/${key}.mp4`;
      if (paid && audio.rec) {
        document.getElementById("transcriptionVideo").style.display = "inline";
        document.getElementById("subtitles").style.display = "inline";
      }
    } else {
      document.getElementById(
        "recordedAudio"
      ).src = `./common/media/${key}_audio.mp3`;
    }
    setTimeout(function () {
      document.getElementById("flag").style.display = "none";
    }, 3000);
    if (paid) {
      document.getElementById("speedVideo").style.display = "inline";
    }
    return;
  } catch (error) {
    document.getElementById("message").textContent = error;
    return error;
  }
}

// Sauvegarde la vidéo enregistrée sur le serveur
async function saveRecordedVideo(key) {
  document.getElementById("loader").style.display = "block";
  document.getElementById("message").textContent =
    "Sauvegarde du média en cours...";

  const fileName =
    document.getElementById("fileNameInput").value || "enregistrement_kanjiru";
  const time = document.getElementById("timer").textContent;

  try {
    const response = await fetch(`/upload/${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fileName, render, time, user }),
    });

    url = await response.text();

    saved = true;

    if (!response.ok || url == "error") {
      throw new Error("Failed to upload video");
    }

    if (paid) {
      document.getElementById("downloadVideo").style.display = "inline";
    }

    if (user != "9f721f62-8c4b-436e-b0c3-aa452f5c08b9") {
      document.getElementById("generateShareLink").style.display = "inline";
    } else {
      document.getElementById(
        "link"
      ).value = `https://app.kanjiru.co/sharelink/${key}`;
      document.getElementById("copyLink").style.display = "flex";
    }

    document.getElementById("loader").style.display = "none";
    document.getElementById("saveFiles").style.display = "none";
    document.getElementById("speedVideo").style.display = "none";
    document.getElementById("transcriptionVideo").style.display = "none";
    document.getElementById("subtitles").style.display = "none";
    document.getElementById("modal").style.display = "none";
    document.getElementById("message").textContent = " ";
  } catch (error) {
    document.getElementById("message").textContent =
      "Communication avec le serveur rompue.";
  }
}

// Applique la vitesse de lecture (générer une nouvelle video avec une nouvelle key)
async function applyPlaybackRate(key) {
  document.getElementById("loader").style.display = "block";
  document.getElementById("message").textContent =
    "Média en cours de traitement...";
  const playbackRate = document.getElementById("playbackRate").value;

  try {
    const response = await fetch(`/speed/${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ playbackRate, render }),
    });

    if (!response.ok) {
      throw new Error("Failed to upload video");
    }

    document.getElementById("playbackRate").disabled = false;
    document.getElementById("loader").style.display = "none";
    document.getElementById("message").textContent =
      "Média accéléré. Pour voir les modifications, sauvegardez le puis téléchargez le ou générez un lien.";
    document.getElementById("speedControl").style.display = "none";
    document.getElementById("speedVideo").style.display = "none";
  } catch (error) {
    document.getElementById("message").textContent = error;
  }
}

// Réalise la retranscription de la vidéo (passe par une URL temporaire)

async function transcribeVideo(key) {
  document.getElementById("loader").style.display = "block";
  document.getElementById("message").textContent =
    "Média en cours de retranscription...";

  try {
    const response = await fetch(`/transcribe/${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("La retranscription a échoué. Essayez de la relancer.");
    }

    const data = await response.json();
    const formattedText = data.formattedText;
    const fileBuffer = data.fileBuffer;

    document.getElementById("transcriptionTitle").style.display = "inline";
    document.getElementById("transcriptionBox").textContent = formattedText;
    document.getElementById("transcriptionBox").style.display = "inline";

    const binary = atob(fileBuffer);
    const array = [];
    for (let i = 0; i < binary.length; i++) {
      array.push(binary.charCodeAt(i));
    }
    const blob = new Blob([new Uint8Array(array)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Retranscription-${key}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    document.getElementById("loader").style.display = "none";
    document.getElementById("message").textContent =
      "Retranscription terminée et téléchargée.";
    document.getElementById("transcriptionVideo").style.display = "none";
  } catch (error) {
    document.getElementById("message").textContent = error;
  }
}

// Réalise le sous-titrage automatique de la vidéo enregistrée

async function subtitleVideo(key) {
  document.getElementById("loader").style.display = "block";
  document.getElementById("message").textContent =
    "Média en cours de sous-titrage...";

  try {
    const response = await fetch(`/subtitle/${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Le sous-titrage a échoué.");
    }

    document.getElementById("loader").style.display = "none";
    document.getElementById("message").textContent =
      "Sous-titrage du média terminé. Pour voir les modifications, sauvegardez le puis téléchargez le ou générez un lien.";
    document.getElementById("subtitles").style.display = "none";
  } catch (error) {
    document.getElementById("message").textContent = error;
  }
}

async function deleteLastFile(key) {
  try {
    const response = await fetch(`/trash/${key}`, { method: "POST" });

    if (!response.ok) {
      throw new Error("Failed to delete last file.");
    }
  } catch (e) {}
}

async function downloadVideo() {
  document.getElementById("loader").style.display = "block";
  document.getElementById("message").textContent =
    "Fichier en cours de téléchargement...";
  try {
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.getElementById("message").textContent = " ";
    document.getElementById("downloadVideo").style.display = "none";
    document.getElementById("loader").style.display = "none";
  } catch (error) {
    document.getElementById("message").textContent =
      "Erreur de communication avec le serveur.";
  }
}

function startRecording(stream) {
  let mimeType = "video/webm; codecs=vp8, opus";
  if (browser === "Safari") {
    mimeType = "video/mp4";
  }
  previewRecorder = new MediaRecorder(stream, {
    mimeType: mimeType,
    videoBitsPerSecond: 1000000,
  });

  previewRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  previewRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const recordedVideoURL = URL.createObjectURL(blob);
    preview.src = recordedVideoURL;
  };

  previewRecorder.start();
}

// Arrête l'enregistrement du flux média
async function stopRecording() {
  if (screen.rec || webcam.rec) {
    previewRecorder.stop();
  }

  if (screen.rec || webcam.rec) {
    screenVideo.style.display = "none";
    webcamVideo.style.display = "none";
    canvas.style.display = "none";
  } else {
    document.getElementById("audioGif").style.display = "none";
  }

  for (let item of medias) {
    await item.stopRecorder();
  }

  renderVideo(uniqueKey);

  document.getElementById("recordedVideo").style.display = "flex";
  document.getElementById("timer").style.display = "none";
  if (audio.rec && !webcam.rec && !screen.rec) {
    document.getElementById("videoRecorded").style.display = "none";
    document.getElementById("recordedAudio").style.display = "block";
  } else {
    document.getElementById("videoRecorded").style.display = "block";
    document.getElementById("recordedAudio").style.display = "none";
  }
}

// Démarre le chronomètre
function startTimer() {
  startTime = Date.now() - elapsedTime;
  timerInterval = setInterval(() => {
    elapsedTime = Date.now() - startTime;
    const minutes = Math.floor((elapsedTime % 3600000) / 60000);
    const seconds = Math.floor((elapsedTime % 60000) / 1000);
    document.getElementById("timer").textContent = `${pad(minutes)}:${pad(
      seconds
    )}`;
    if (!paid && elapsedTime > limit) {
      document.getElementById("stopRecording").click();
      document.getElementById("validModal").style.display = "none";
      document.getElementById("return").style.display = "none";
      document.getElementById("limit").style.display = "block";
      document.getElementById("modal").style.display = "flex";
      document.getElementById("modal-text").textContent =
        "Vous avez atteint la limite de taille pour un média avec un compte gratuit.";
    }
  }, 1000);
}

// Met en pause le chronomètre
function pauseTimer() {
  clearInterval(timerInterval);
}

// Arrête le chronomètre
function stopTimer() {
  clearInterval(timerInterval);
}

// Ajoute un zéro au début des nombres inférieurs à 10
function pad(number) {
  return number < 10 ? "0" + number : number;
}

// Génère une clé unique pour identifier les enregistrements
function generateUniqueKey() {
  return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".replace(/[x]/g, function () {
    const r = (Math.random() * 16) | 0;
    return r.toString(16);
  });
}

function copyToClipboard() {
  var input = document.getElementById("link");
  input.select();
  input.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(input.value);
}

function detectBrowser() {
  const userAgent = navigator.userAgent;
  let browserName = "Inconnu";

  if (/chrome|chromium|crios/i.test(userAgent)) {
    browserName = "Chrome";
  } else if (/firefox|fxios/i.test(userAgent)) {
    browserName = "Firefox";
  } else if (/safari/i.test(userAgent)) {
    browserName = "Safari";
  } else if (/opr\//i.test(userAgent)) {
    browserName = "Opera";
  } else if (/edg/i.test(userAgent)) {
    browserName = "Edge";
  } else if (/msie|trident/i.test(userAgent)) {
    browserName = "Internet Explorer";
  }

  return browserName;
}
