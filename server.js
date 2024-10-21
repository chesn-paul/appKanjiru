import dotenv from "dotenv";
dotenv.config();
import express from "express";
import multer from "multer";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createMedia, getType } from "./model/supabase.js";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
} from "docx";
import { fileURLToPath } from "url";

// Pour gérer __dirname dans les modules ES6 (sinon erreur lors du lancement de l'app dans la VM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 8080;
const accessKey = process.env.DO_ACCESS_KEY;
const secretKey = process.env.DO_SECRET_KEY;
const endpoint = "https://kanjiruvideo.fra1.digitaloceanspaces.com";
const region = "fra1";

// Configuration du client S3
const s3Client = new S3Client({
  region: region,
  endpoint: endpoint,
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  },
  forcePathStyle: true,
  signatureVersion: "v4",
});

// Configuration de ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Configuration de multer pour les fichiers uploadés
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "common/media/");
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 4000 * 1024 * 1024 },
});

// Configuration des middlewares
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "common")));

app.use(express.json({ limit: "4gb" }));
app.use(express.urlencoded({ limit: "4gb", extended: true }));

// Routes
app.post("/tracks", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("Aucun fichier téléchargé.");
  }
  res.send("Sauvegardé.");
});

app.post("/render/:key", (req, res) => {
  async function main() {
    const mainDir = path.join(__dirname, "common/media");
    const uniqueKey = req.params.key; //III
    const outputPath = path.join(mainDir, `${uniqueKey}.mp4`);

    let components = req.body.render; //III
    let onlyAudio;
    let dir = [];
    dir.push(path.join(mainDir, `${uniqueKey}_audio.webm`));
    dir.push(path.join(mainDir, `${uniqueKey}_video.webm`));
    dir.push(path.join(mainDir, `${uniqueKey}_webcam.webm`));

    let videoDir;

    if (components[1] && components[2]) {
      videoDir = path.join(mainDir, `${uniqueKey}_wv.mp4`);
      // await scale(dir[1], req.body.screenWidth, req.body.screenHeight);
      await scale(dir[2], 300, 300 / req.body.webRatio);
      await videoCam(
        dir[1],
        dir[2],
        videoDir,
        req.body.screenWidth,
        req.body.screenHeight
      );
    } else if (components[1] && !components[2]) {
      videoDir = path.join(mainDir, `${uniqueKey}_video.mp4`);
      await videoConversion(dir[1], videoDir);
    } else if (!components[1] && components[2]) {
      videoDir = path.join(mainDir, `${uniqueKey}_webcam.mp4`);
      await videoConversion(dir[2], videoDir);
    } else if (components[0] && !components[1] && !components[2]) {
      onlyAudio = true;
    }

    if (components[0]) {
      if (!onlyAudio) {
        await audioAssociation(
          videoDir,
          dir[0],
          path.join(mainDir, `${uniqueKey}_wva.mp4`)
        );
      } else {
        await audioConversion(
          dir[0],
          path.join(mainDir, `${uniqueKey}_audio.mp3`)
        );
      }
    }

    if (!onlyAudio) {
      fs.renameSync(videoDir, outputPath);
    }
    console.log("Rendering done.");
    res.send("Rendering done.");
  }

  main();
});

app.post("/upload/:key", (req, res) => {
  async function main() {
    const fileName = req.body.fileName; //III
    const uniqueKey = req.params.key; //III
    const videoPath = path.join(__dirname, "common/media", `${uniqueKey}.mp4`);
    const audioPath = path.join(
      __dirname,
      "common/media",
      `${uniqueKey}_audio.mp3`
    );

    let onlyAudio = mediaType(req.body.render); //III
    let objectKey;
    let bucket;
    let params;

    if (!onlyAudio) {
      const videoFileContent = fs.readFileSync(videoPath);

      if (videoFileContent.length == 0) {
        throw new Error("Video file is empty.");
      } else {
        params = {
          Bucket: "videos",
          Key: `${uniqueKey}.mp4`,
          Body: videoFileContent,
          ContentType: "video/mp4",
          ACL: "public-read",
        };

        uploadFile(params, videoPath);

        objectKey = `${uniqueKey}.mp4`;
        bucket = "videos";
      }
    } else {
      const audioFileContent = fs.readFileSync(audioPath);

      if (audioFileContent.length == 0) {
        throw new Error("Audio file is empty.");
      } else {
        params = {
          Bucket: "audios",
          Key: `${uniqueKey}_audio.mp3`,
          Body: audioFileContent,
          ContentType: "audio/mp3",
          ACL: "public-read",
        };

        uploadFile(params, audioPath);

        objectKey = `${uniqueKey}_audio.mp3`;
        bucket = "audios";
      }
    }

    if (!onlyAudio) {
      params = {
        Bucket: bucket,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename="${fileName}.mp4"`,
      };
    } else {
      params = {
        Bucket: bucket,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename="${fileName}.mp3"`,
      };
    }

    try {
      const command = new GetObjectCommand(params);
      const url = await getSignedUrl(s3Client, command, { expiresIn: 604800 });

      const error = await createMedia(
        uniqueKey,
        fileName,
        bucket,
        req.body.time,
        req.body.user,
        url
      );

      if (error) {
        console.log(error);
        res.send("error");
      } else {
        res.send(url);
      }
    } catch (err) {
      console.error("Error during pre-signed file url generation:", err);
    }
  }

  main();
});

app.post("/speed/:key", (req, res) => {
  async function main() {
    const uniqueKey = req.params.key; //III

    let onlyAudio = mediaType(req.body.render); //III
    console.log(onlyAudio);
    if (!onlyAudio) {
      const inputPath = path.join(__dirname, "common/media", `delete.mp4`);
      const outputPath = path.join(
        __dirname,
        "common/media",
        `${uniqueKey}.mp4`
      );

      fs.renameSync(outputPath, inputPath);

      await changeVideoSpeed(inputPath, outputPath, req.body.playbackRate);

      console.log("Video speed change.");
      res.send("Video speed change.");
    } else {
      const inputPath = path.join(__dirname, "common/media", `delete.mp3`);
      const outputPath = path.join(
        __dirname,
        "common/media",
        `${uniqueKey}_audio.mp3`
      );

      fs.renameSync(outputPath, inputPath);

      await changeAudioSpeed(inputPath, outputPath, req.body.playbackRate);

      console.log("Audio speed change.");
      res.send("Audio speed change.");
    }
  }

  main();
});

app.post("/transcribe/:key", async (req, res) => {
  const uniqueKey = req.params.key;
  const inputPath = path.join(__dirname, "common/media", `${uniqueKey}.mp4`);
  const outputPath = path.join(__dirname, "common/media", `${uniqueKey}.mp3`);

  try {
    await convertToMp3(inputPath, outputPath);

    const transcription = await query(outputPath);

    let formattedText = transcription.text.trim();
    if (!formattedText.endsWith(".")) {
      formattedText += ".";
    }
    formattedText =
      formattedText.charAt(0).toUpperCase() + formattedText.slice(1);

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: "Retranscription",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: {
                after: 200,
              },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: formattedText || "Aucune retranscription disponible.",
                  font: "Arial",
                  size: 24,
                }),
              ],
              alignment: AlignmentType.JUSTIFIED,
              spacing: {
                after: 100,
              },
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Transcription-${uniqueKey}.docx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    res.json({ formattedText, fileBuffer: buffer.toString("base64") });

    deleteConvertedAudio(outputPath);
  } catch (error) {
    console.error("Erreur dans le processus de transcription :", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/subtitle/:key", async (req, res) => {
  const uniqueKey = req.params.key;
  const inputPath = path.join(__dirname, "common/media", `${uniqueKey}.mp4`);
  const outputPath = path.join(
    __dirname,
    "common/media",
    `${uniqueKey}_subtitled.mp4`
  );

  const srtPath = path.join(__dirname, "common/transcript", `${uniqueKey}.srt`);

  try {
    const audioPath = path.join(__dirname, "common/media", `${uniqueKey}.mp3`);
    await convertToMp3(inputPath, audioPath);

    const transcription = await query(audioPath);

    console.log(JSON.stringify(transcription));

    await generateSRT(transcription, uniqueKey);

    await addSubtitlesToVideo(inputPath, srtPath, outputPath);

    fs.renameSync(outputPath, inputPath);

    deleteConvertedAudio(audioPath);

    deleteSRTFile(uniqueKey);

    res.status(200).json({ message: "Sous-titres ajoutés avec succès" });
  } catch (error) {
    console.error("Erreur dans le processus de sous-titrage :", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/trash/:key", (req, res) => {
  fs.readdirSync(path.join(__dirname, "common/media")).forEach((file) => {
    if (file.includes(req.params.key)) {
      fs.unlinkSync(path.join(__dirname, "common/media", file));
      console.log("File delete.");
      res.send("File delete.");
    }
  });
});

app.get("/sharelink/:key", (req, res) => {
  async function main() {
    const data = await getType(req.params.key);
    const type = data["type"];
    const title = data["name"];
    let src;
    if (data["type"] == "audios") {
      src = `${endpoint}/${type}/${req.params.key}_audio.mp3`;
      res.send(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="stylesheet" href="css/style.css">
                <title>${title}</title>
                <style>
                .videos{
                    background-color: black;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100vw;
                    height: 100vh;
                    padding: 0;
                    margin : 0;
                }
                .videos video{
                    height: 80vh;
                }
                a{
                    display: flex;
                    align-items: center;
                    position: fixed;
                    top: 20px;
                    left: 20px;
                  }
                a > div {
                    color: white;
                    margin-left: 10px;
                    font-size: 20px;
                    font-family: 'Calibri';
                  }

                a > div:hover{
                    font-weight: bold;
                  }

                  a > div:active{
                      color: white;
                  }
                </style>
            </head>
            <body class="videos">
              <a href="https://www.kanjiru.co">
                <img width="40px" src="https://jkevlpqsaagrpzdtaadc.supabase.co/storage/v1/object/public/Files/logo_kan.png?t=2024-10-18T09%3A46%3A36.178Z">
                <div>Kanjiru</div>
              </a>
                <video controls autoplay src="${src}"></video>
            </body>
          </html>
      `);
    } else {
      src = `${endpoint}/${type}/${req.params.key}.mp4`;
      res.send(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="stylesheet" href="css/style.css">
                <title>${title}</title>
                <style>
                .videos{
                    background-color: black;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100vw;
                    height: 100vh;
                    padding: 0;
                    margin : 0;
                }
                .videos video{
                    height: 80vh;
                }
                a{
                    display: flex;
                    align-items: center;
                    position: fixed;
                    top: 20px;
                    left: 20px;
                  }
                a > div {
                    color: white;
                    margin-left: 10px;
                    font-size: 20px;
                    font-family: 'Calibri';
                  }

                a > div:hover{
                    font-weight: bold;
                  }

                  a > div:active{
                      color: white;
                  }
                </style>
            </head>
            <body class="videos">
              <a href="https://www.kanjiru.co">
                <img width="40px" src="https://jkevlpqsaagrpzdtaadc.supabase.co/storage/v1/object/public/Files/logo_kan.png?t=2024-10-18T09%3A46%3A36.178Z">
                <div>Kanjiru</div>
              </a>
                <video controls autoplay src="${src}"></video>
            </body>
          </html>
      `);
    }
  }
  main();
});

function scale(inputPath, width, height) {
  return new Promise((resolve, reject) => {
    const output = "/mnt/ramdisk/delete.webm"; // Utilisation de tmpfs pour le fichier temporaire

    ffmpeg(inputPath)
      .output(output)
      .videoCodec("libvpx")
      .size(`${width}x${height}`)
      .outputOptions([
        "-preset ultrafast",
        "-crf 30",
        "-threads 4",
        "-vf",
        `scale=${width}:${height}:flags=fast_bilinear`,
      ])
      .on("end", () => {
        console.log("Video resizing completed.");

        // Copie du fichier du ramdisk vers l'emplacement final
        fs.copyFile(output, inputPath, (copyErr) => {
          if (copyErr) {
            console.error("Copy failed:", copyErr.message);
            reject(copyErr);
          } else {
            // Suppression du fichier source dans le ramdisk
            fs.unlink(output, (unlinkErr) => {
              if (unlinkErr) {
                console.error("Unlink failed:", unlinkErr.message);
                reject(unlinkErr);
              } else {
                resolve();
              }
            });
          }
        });
      })
      .on("error", (err) => {
        console.error("Error:", err.message);
        reject(err);
      })
      .run();
  });
}

function audioConversion(inputAudioPath, outputAudioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputAudioPath)
      .output(outputAudioPath)
      .audioCodec("libmp3lame")
      .on("end", () => {
        console.log("Audio conversion done.");
        fs.unlinkSync(inputAudioPath);
        resolve();
      })
      .on("error", (err) => {
        console.error("Error: ", err.message);
        reject(err);
      })
      .run();
  });
}

function changeVideoSpeed(inputPath, outputPath, speedFactor) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(`setpts=${1 / speedFactor}*PTS, fps=30`)
      .audioFilters(`atempo=${speedFactor}`)
      .output(outputPath)
      .on("end", function () {
        console.log("Video speed change.");
        fs.unlinkSync(inputPath);
        resolve();
      })
      .on("error", function (err) {
        console.error("Error : " + err.message);
        reject(err);
      })
      .run();
  });
}
function changeAudioSpeed(input, output, speedFactor) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioFilters(`atempo=${speedFactor}`)
      .on("end", () => {
        console.log("Audio speed change.");
        fs.unlinkSync(input);
        resolve();
      })
      .on("error", (err) => {
        console.error("Error : ", err);
        reject(err);
      })
      .save(output);
  });
}

function videoCam(input1, input2, output, width, height) {
  const watermark = path.join(__dirname, "public/ressource/watermark.png");
  const ramdiskOutput = "/mnt/ramdisk/output.mp4"; // Utilisation de tmpfs pour le fichier temporaire

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(input1)
      .input(input2)
      .input(watermark)
      .complexFilter([
        `nullsrc=size=${width}x${height}:rate=35[base]`,
        "[0:v]setpts=PTS-STARTPTS[video1]",
        "[1:v]setpts=PTS-STARTPTS[video2]",
        "[base][video1]overlay=shortest=1:x=0:y=(W-w)/2[base_video1]",
        "[base_video1][video2]overlay=shortest=1:x=W-w-20:y=20[base_video2]",
        `[base_video2][2:v]overlay=x=10:y=${height}-64`,
      ])
      .videoCodec("libx264")
      .outputOptions([
        "-preset veryfast",
        "-threads 4",
        "-crf 30",
        "-pix_fmt yuv420p",
      ])
      .output(ramdiskOutput)
      .on("end", () => {
        console.log("Assembly finished.");

        // Copie du fichier du ramdisk vers l'emplacement final
        fs.copyFile(ramdiskOutput, output, (copyErr) => {
          if (copyErr) {
            console.error("Copy failed:", copyErr.message);
            reject(copyErr);
          } else {
            // Suppression du fichier source dans le ramdisk
            fs.unlink(ramdiskOutput, (unlinkErr) => {
              if (unlinkErr) {
                console.error("Unlink failed:", unlinkErr.message);
                reject(unlinkErr);
              } else {
                resolve();
              }
            });
          }
        });

        // Suppression des fichiers d'entrée pour libérer de l'espace
        fs.unlink(input1, (err) => {
          if (err) console.error("Error deleting input1:", err.message);
        });
        fs.unlink(input2, (err) => {
          if (err) console.error("Error deleting input2:", err.message);
        });
      })
      .on("error", (err) => {
        console.error("Error : " + err.message);
        reject(err);
      })
      .run();
  });
}

function audioAssociation(input, audio, output) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(input)
      .input(audio)
      .outputOptions("-c:v copy")
      .outputOptions("-c:a aac")
      .outputOptions("-strict experimental")
      .output(output)
      .on("end", () => {
        console.log("Audio associated.");
        fs.unlinkSync(input);
        fs.unlinkSync(audio);
        fs.renameSync(output, input);
        resolve();
      })
      .on("error", (err) => {
        console.error("Error: " + err.message);
        reject(err);
      })
      .run();
  });
}

function videoConversion(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(input)
      .outputOptions("-c:v libx264")
      .outputOptions("-c:a aac")
      .outputOptions("-strict experimental")
      .output(output)
      .on("end", () => {
        console.log("Video conversion done.");
        fs.unlinkSync(input);
        resolve();
      })
      .on("error", (err) => {
        console.error("Error: ", err.message);
        reject(err);
      })
      .run();
  });
}

async function query(filename) {
  const data = fs.readFileSync(filename);
  const response = await fetch(
    "https://api-inference.huggingface.co/models/openai/whisper-large-v3",
    {
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: data,
    }
  );
  const result = await response.json();
  return result;
}

async function uploadFile(params, filePath) {
  try {
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);
    console.log("File uploaded: ", response);
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error("Error: ", err);
  }
}

function mediaType(render) {
  if (render[1] || render[2]) {
    return false;
  } else {
    return true;
  }
}

function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate(192)
      .on("start", (commandLine) => {
        console.log("Spawned FFmpeg with command: " + commandLine);
      })
      .on("progress", (progress) => {
        process.stdout.write(
          `Processing: ${
            progress.percent ? progress.percent.toFixed(2) : "0"
          }% done\r`
        );
      })
      .on("error", (err, stdout, stderr) => {
        console.error("Une erreur est survenue : " + err.message);
        console.error("FFmpeg stderr : " + stderr);
        reject(err);
      })
      .on("end", () => {
        console.log("\nConversion terminée avec succès !");
        resolve();
      })
      .save(outputPath);
  });
}

function deleteConvertedAudio(filePath) {
  try {
    fs.unlinkSync(filePath);
    console.log(`Le fichier MP3 à ${filePath} a été supprimé avec succès.`);
  } catch (err) {
    console.error(
      `Erreur lors de la suppression du fichier MP3 à ${filePath} :`,
      err
    );
  }
}

function addSubtitlesToVideo(videoPath, subtitlePath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(
        "-vf",
        `subtitles=${subtitlePath}:force_style='FontName=DejaVu Sans,FontSize=18,PrimaryColour=&HFFFFFF&'`
      )
      .on("start", (commandLine) => {
        console.log(`FFmpeg process started: ${commandLine}`);
      })
      .on("progress", (progress) => {
        console.log(`Processing: ${progress.percent}% done`);
      })
      .on("error", (err) => {
        console.error(`Error occurred: ${err.message}`);
        reject(err); // Rejet de la promesse en cas d'erreur
      })
      .on("end", () => {
        console.log("Subtitles have been added to the video.");
        resolve(); // Résolution de la promesse une fois la tâche terminée
      })
      .save(outputPath);
  });
}

async function generateSRT(transcription, uniqueKey) {
  if (!transcription || !transcription.text) {
    throw new Error('Transcription invalide : propriété "text" manquante.');
  }

  const words = transcription.text.split(" ");
  const interval = 4.2; // Intervalle de temps en secondes
  let srtContent = "";
  let startTime = 0;

  function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const minutes = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    const millis = Math.floor((seconds % 1) * 1000)
      .toString()
      .padStart(3, "0");
    return `${hours}:${minutes}:${secs},${millis}`;
  }

  for (let i = 0; i < words.length; i += 10) {
    const endTime = startTime + interval;
    const line = words.slice(i, i + 10).join(" ");
    srtContent += `${Math.floor(i / 10) + 1}\n`;
    srtContent += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`;
    srtContent += `${line.trim()}\n\n`;
    startTime = endTime;
  }

  const srtDir = path.join(__dirname, "common/transcript");
  if (!fs.existsSync(srtDir)) {
    fs.mkdirSync(srtDir, { recursive: true });
  }

  const srtFile = path.join(srtDir, `${uniqueKey}.srt`);
  fs.writeFileSync(srtFile, srtContent);
  console.log(`Fichier SRT enregistré à : ${srtFile}`);
}

function deleteSRTFile(uniqueKey) {
  const srtFilePath = path.join(
    __dirname,
    "common/transcript",
    `${uniqueKey}.srt`
  );

  if (fs.existsSync(srtFilePath)) {
    fs.unlinkSync(srtFilePath);
    console.log(`Fichier SRT supprimé : ${srtFilePath}`);
  } else {
    console.log("Le fichier SRT n'existe pas.");
  }
}

app.listen(port, "0.0.0.0", () => {
  console.log(`VM en ligne sur https://app.kanjiru.co`);
});
