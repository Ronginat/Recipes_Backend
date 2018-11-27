const AWS = require('aws-sdk');
const gm = require("gm").subClass({imageMagick: true});

AWS.config.update({region: process.env['REGION']});

const s3 = new AWS.S3();

// https://github.com/sailyapp/aws-s3-lambda-thumbnail-generator

const 
    THUMB_WIDTH = 300,
    THUMB_HEIGHT = 300,
    ALLOWED_FILETYPES = ['png', 'jpg', 'jpeg'];

async function download(fileName, dir) {
    const srcKey = dir + '/' + fileName;
    return new Promise((resolve, reject) => {
        s3.getObject({
            Bucket: process.env['BUCKET'],
            Key: srcKey
          }, (err, data) => {
              if (err) reject(err);
              else resolve(data);
          });
    }); 
}

/*
* scalingFactor should be calculated to fit either the width or the height
* within 150x150 optimally, keeping the aspect ratio. Additionally, if the image 
* is smaller than 150px in both dimensions, keep the original image size and just 
* convert to png for the thumbnail's display
*/
async function createThumbnail(s3_response) {
    const image = gm(s3_response.Body);

    return new Promise((resolve, reject) => {
        image.size((err, size) => {
            if (err) reject(err);
            else {
                // if the size is small enough, don't resize the image
                if (Number(s3_response.ContentLength) <= Number(process.env['LARGEST_ALLOWED_SIZE'])) {
                    image.toBuffer("jpg", (err, buffer) => {
                        if (err) reject(err);
                        else resolve(buffer);
                    });
                }
                else {
                    const scalingFactor = Math.min(1, THUMB_WIDTH / size.width, THUMB_HEIGHT / size.height);
                    const width = scalingFactor * size.width;
                    const height = scalingFactor * size.height;

                    image.resize(width, height)
                        .toBuffer("jpg", (err, buffer) => {
                            if (err) reject(err);
                            else resolve(buffer);
                        });
                }
            }
        });
    });
}

async function uploadThumbnail(fileName, data) {
    const dstKey = process.env['FOLDER'] + '/' + fileName;
    return new Promise((resolve, reject) => {
        s3.putObject({
            Bucket: process.env['BUCKET'],
            Key: dstKey,
            Body: data,
            ContentType: "image/jpeg",
            Metadata: {
              thumbnail: 'TRUE'
            }
          }, (err, data) => {
              if (err) reject(err);
              else resolve(data);
          });
    });
}

exports.handler = async (event, context) => {
    try {
        console.log(event);
        const fileType = event.fileName.split('.')[1];
        if (!ALLOWED_FILETYPES.includes(fileType))
            throw "file extension not supported, " + event.fileName;
        const s3_response = await download(event.fileName, event.fileDir);
        console.log(s3_response);

        const uploadReq = await createThumbnail(s3_response);
        //console.log("upload request: \n" + uploadReq);

        await uploadThumbnail(event.fileName, uploadReq);
        //const uploadRes = await uploadThumbnail(event.fileName, uploadReq);
        //console.log("upload response: \n" + uploadRes);

        context.done();

    } catch(err) {
        console.log("error when generating thumbnail.\n" + err);
        context.done(err);
    }
};