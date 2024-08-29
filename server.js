// -----Librairies-----
import dotenv from 'dotenv'
dotenv.config()
import express from "express";
import multer from "multer";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import bodyParser from 'body-parser';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand,  } from '@aws-sdk/client-s3' ;
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {createMedia, getType} from './model/supabase.js' 
import { ContinuationSeparator } from 'docx';

const app = express();
const port = 8080;
const accessKey = process.env.DO_ACCESS_KEY;
const secretKey = process.env.DO_SECRET_KEY;
const endpoint = 'https://kanjiruvideo.fra1.digitaloceanspaces.com';
const region = 'fra1';
const __dirname = import.meta.dirname;
// const __dirname = '/root/appKanjiru';



ffmpeg.setFfmpegPath(ffmpegPath);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log(__dirname);
    const uploadDir = path.join(__dirname, "common/media");
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, "public")));

app.use(express.static(path.join(__dirname, "common")));

app.use(bodyParser.json());

app.post("/tracks", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send('Aucun fichier téléchargé.');
  }
  res.send('Sauvegardé.');
});

app.post("/render/:key", (req, res) => {
  async function main() {

    const mainDir = path.join(__dirname, "common/media");
    const uniqueKey = req.params.key;//III
    const outputPath = path.join(mainDir, `${uniqueKey}.mp4`);

    let components = req.body.render;//III
    let onlyAudio;
    let dir = [];
    dir.push(path.join(mainDir, `${uniqueKey}_audio.webm`));
    dir.push(path.join(mainDir, `${uniqueKey}_video.webm`));
    dir.push(path.join(mainDir, `${uniqueKey}_webcam.webm`));
    let videoDir;

    if(components[1] && components[2]){

      videoDir = path.join(mainDir, `${uniqueKey}_wv.mp4`);
      //await scale(dir[1], req.body.screenWidth, req.body.screenHeight); 
      await scale(dir[2], 300, 300/req.body.webRatio );
      await videoCam(dir[1], dir[2], videoDir, req.body.screenWidth, req.body.screenHeight);

    }else if(components[1] && !components[2]){

      videoDir = path.join(mainDir, `${uniqueKey}_video.mp4`);
      await videoConversion(dir[1], videoDir);

    }else if(!components[1] && components[2]){

      videoDir = path.join(mainDir, `${uniqueKey}_webcam.mp4`);
      await videoConversion(dir[2], videoDir);

    }else if(components[0] && !components[1] && !components[2]){

      onlyAudio = true;

    }
    
    if(components[0]){ 
      if(!onlyAudio){
        await audioAssociation(videoDir, dir[0], path.join(mainDir, `${uniqueKey}_wva.mp4`));
      }else{
        await audioConversion(dir[0], path.join(mainDir, `${uniqueKey}_audio.mp3`))
      }
    }

    if(!onlyAudio){fs.renameSync(videoDir, outputPath)};
    console.log("Rendering done.")
    res.send("Rendering done.")
  }

  main();


});


app.post("/upload/:key", (req, res) => {
  async function main() {

    const fileName = req.body.fileName;//III
    const uniqueKey = req.params.key;//III
    const videoPath = path.join(__dirname, "common/media", `${uniqueKey}.mp4`);
    const audioPath = path.join(__dirname, "common/media", `${uniqueKey}_audio.mp3`);

    let onlyAudio = mediaType(req.body.render)//III
    let objectKey;
    let bucket;
    let params;

    if(!onlyAudio){

      const videoFileContent = fs.readFileSync(videoPath);

      if(videoFileContent.length == 0 ){
        throw new Error('Video file is empty.');
      }else{

        params = {
          Bucket: "videos",
          Key: `${uniqueKey}.mp4`,
          Body: videoFileContent,
          ContentType: 'video/mp4'
        };

        uploadFile(params, videoPath);

        objectKey = `${uniqueKey}.mp4`;
        bucket = 'videos';

      }

    }else{

      const audioFileContent = fs.readFileSync(audioPath);
        
      if(audioFileContent.length == 0 ){
        throw new Error('Audio file is empty.');
      }else{
      
        params = {
          Bucket: "audios",
          Key: `${uniqueKey}_audio.mp3`,
          Body: audioFileContent,
          ContentType: 'audio/mp3'
        };

        uploadFile(params, audioPath);

        objectKey = `${uniqueKey}_audio.mp3`;
        bucket = 'audios';

      }
    }

    const s3Client = new S3Client({
      region: region,
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true, 
      signatureVersion: 'v4'
    });

    params = {
      Bucket: bucket,
      Key: objectKey,
      ResponseContentDisposition: `attachment; filename="${fileName}.mp4"`
    };

    try {
      const command = new GetObjectCommand(params);
      const url =  await getSignedUrl(s3Client, command, { expiresIn: 604800 });

      res.send(url);
      const {error} = await createMedia(uniqueKey, fileName, bucket, req.body.time, req.body.user, url);
      if(error){console.log(error)};

    } catch (err) {
      console.error('Error during pre-signed file url generation:', err);
    }

  }

  main();

});


app.post("/speed/:key", (req, res) => {
  async function main(){

    const uniqueKey = req.params.key;//III

    let onlyAudio = mediaType(req.body.render);//III
    console.log(onlyAudio)
    if(!onlyAudio){
      const inputPath = path.join(__dirname, "common/media", `delete.mp4`);
      const outputPath = path.join(__dirname, "common/media", `${uniqueKey}.mp4`);

      fs.renameSync(outputPath, inputPath);

      await changeVideoSpeed(inputPath, outputPath, req.body.playbackRate);

      console.log('Video speed change.');
      res.send('Video speed change.');

    }else{

      const inputPath = path.join(__dirname, "common/media", `delete.mp3`);
      const outputPath = path.join(__dirname, "common/media", `${uniqueKey}_audio.mp3`);

      fs.renameSync(outputPath, inputPath);

      await changeAudioSpeed(inputPath, outputPath, req.body.playbackRate);

      console.log('Audio speed change.');
      res.send('Audio speed change.');

    }

  }

  main();

});

app.post("/trash/:key", (req, res) => {
  fs.readdirSync(path.join(__dirname, "common/media")).forEach(file =>{
      if(file.includes(req.params.key)){
        fs.unlinkSync(path.join(__dirname, "common/media", file));
        console.log('File delete.');
        res.send('File delete.')
      }
  });
});

app.get("/delete/:key", (req, res) => {

  const s3Client = new S3Client({
    region: region,
    endpoint: endpoint,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });
  
  async function listAndDeleteFiles() {

    try {
      let continuationToken;
      let bucket = await getType(req.params.key)
      do {
        const command = new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        });
  
        const response = await s3Client.send(command);
        const contents = response.Contents;
  
        for (const object of contents) {
          const key = object.Key;
          if (key.includes(req.params.key)) {
            console.log(`Suppression du fichier: ${key}`);
            await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
          }
        }
  
        continuationToken = response.NextContinuationToken;
      } while (continuationToken);
  
      console.log("Tous les fichiers contenant le numéro ont été supprimés.");
    } catch (error) {
      console.error("Erreur lors de la liste ou de la suppression des fichiers:", error);
    }
  }
  
  listAndDeleteFiles();

});



function scale(inputPath, width, height) {
  return new Promise((resolve, reject) => {  
    const output = path.join(__dirname, "common/media/delete.webm");
    ffmpeg(inputPath)
      .output(output)
      .videoCodec('libvpx')
      .size(`${width}x${height}`)
      .on('end', () => {
        console.log('Video resizing completed.');
        fs.unlinkSync(inputPath);
        fs.renameSync(output, inputPath);
        resolve();
      })
      .on('error', (err) => {
        console.error('Error:', err.message);
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
      .audioCodec('libmp3lame')
      .on('end', () => {
        console.log('Audio conversion done.');
        fs.unlinkSync(inputAudioPath);
        resolve();
      })
      .on('error', (err) => {
        console.error('Error: ', err.message);
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
      .on('end', function() {
        console.log('Video speed change.');
        fs.unlinkSync(inputPath);
        resolve();
      })
      .on('error', function(err) {
        console.error('Error : ' + err.message);
        reject(err);
      })
      .run();
  });
}
function changeAudioSpeed(input, output, speedFactor){
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioFilters(`atempo=${speedFactor}`)
      .on('end', () => {
        console.log('Audio speed change.', outputAudioPath);
        fs.unlinkSync(input);
        resolve();
      })
      .on('error', (err) => {
        console.error('Error : ', err);
        reject(err);
      })
      .save(output);
  });
}

function videoCam (input1, input2, output, width, height){
  const watermark = path.join(__dirname, "public/ressource/watermark.png");
  return new Promise((resolve, reject) => {
    ffmpeg()
    .input(input1)
    .input(input2)
    .input(watermark)
    .complexFilter([
      `nullsrc=size=${width}x${height}:rate=35[base]`,
      '[0:v]setpts=PTS-STARTPTS[video1]',
      '[1:v]setpts=PTS-STARTPTS[video2]',
      '[base][video1]overlay=shortest=1:x=0:y=(W-w)/2[base_video1]',
      '[base_video1][video2]overlay=shortest=1:x=W-w-20:y=20[base_video2]',
      `[base_video2][2:v]overlay=x=10:y=${height}-64`
    ])
    .videoCodec('libx264')
    .outputOptions('-pix_fmt', 'yuv420p')
    .output(output)
    .on('end', () => {
      console.log('Assembly finished.');
      fs.unlinkSync(input1);
      fs.unlinkSync(input2);
      resolve();
    })
    .on('error', (err) => {
      console.error('Error : ' + err.message);
      reject(err);
    })
    .run();
  });
}

function audioAssociation(input, audio, output){
  return new Promise((resolve, reject) => {
    ffmpeg()
    .input(input)
    .input(audio)
    .outputOptions('-c:v copy') 
    .outputOptions('-c:a aac')  
    .outputOptions('-strict experimental') 
    .output(output)
    .on('end', () => {
      console.log('Audio associated.');
      fs.unlinkSync(input);
      fs.unlinkSync(audio);
      fs.renameSync(output,input);
      resolve();
    })
    .on('error', (err) => {
      console.error('Error: ' + err.message);
      reject(err);
    })
    .run();
  });
}


function videoConversion(input, output){
  return new Promise((resolve, reject) => {
    ffmpeg()
    .input(input)
    .outputOptions('-c:v libx264')
    .outputOptions('-c:a aac')
    .outputOptions('-strict experimental')
    .output(output)
    .on('end', () => {
      console.log('Video conversion done.');
      fs.unlinkSync(input);
      resolve();
    })
    .on('error', (err) => {
      console.error('Error: ', err.message);
      reject(err);
    })
    .run();
  });
}

async function uploadFile(params,filePath) {

  const s3Client = new S3Client({
    region: region,
    endpoint: endpoint,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: true, 
    signatureVersion: 'v4'
  });

  try {
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);
    console.log('File uploaded: ', response);
  } catch (err) {
    console.error('Error: ', err);
  }

  fs.unlinkSync(filePath);

}

function mediaType(render){
  if(render[1]||render[2]){
    return false;
  }else{
    return true; 
  }
}

app.listen(port, () => {
  console.log(__dirname);
});
