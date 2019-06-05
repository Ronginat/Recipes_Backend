const AWS = require('aws-sdk');
AWS.config.update({region: process.env['REGION']});

const s3 = new AWS.S3();

const admin = require('firebase-admin');

const serviceAccount = require('serviceAccount.json');

/**
 * Triggered when image uploaded to /thumbnails in bucket.
 * Upload the new file to firebase storage using firebase-admin sdk.
 */

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: process.env['FIREBASE_BUCKET_URL']
});

function download(key, bucket) {
    return new Promise((resolve, reject) => {
        s3.getObject({
            Bucket: bucket,
            Key: key
          }, (err, data) => {
              if (err) reject(err);
              else resolve({
                  s3_object: data.Body,
                  contentType: data.ContentType
              });
          });
    }); 
}

function uploadToFirebase(name, buffer, type) {
    return admin.storage().bucket().file(name).save(buffer, {
        resumable: false,
        contentType: type
    });
}

exports.handler = async (event, context, callback) => {
    console.log(JSON.stringify(event));
    const record = event['Records'][0];

    if (record['eventName'] === 'ObjectCreated:Put') {
        try {
            const uploadedName = record['s3']['object']['key'];
            const bucket = record['s3']['bucket']['name'];

            const { s3_object, contentType } = await download(uploadedName, bucket);
            const result = await uploadToFirebase(uploadedName, s3_object, contentType);
            console.log('success upload to firebsae, file = ' + uploadedName + ', result = ' + result);
            callback(null);
        } catch (err) {
            console.log('err ', JSON.stringify(err));
            callback(err);
        }
    } else 
        callback(null);
}