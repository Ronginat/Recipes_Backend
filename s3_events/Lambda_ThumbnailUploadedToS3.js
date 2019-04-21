const AWS = require('aws-sdk');
AWS.config.update({region: process.env['REGION']});

const s3 = new AWS.S3();

const admin = require('firebase-admin');

const serviceAccount = require('serviceAccount.json');

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
              else resolve(data.Body);
          });
    }); 
}

function uploadToFirebase(name, buffer, type) {
    return admin.storage().bucket().file(name).save(buffer, {
        resumable: false,
        contentType: type
    });
}

exports.handler = async function(event, context, callback) {
    console.log(JSON.stringify(event));
    const record = event['Records'][0];

    if (record['eventName'] === 'ObjectCreated:Put') {
        try {
            const uploadedName = record['s3']['object']['key'];
            const bucket = record['s3']['bucket']['name'];

            
            const splittedName = uploadedName.split(".");
            let extension = splittedName[splittedName.length - 1];
            if (extension === 'jpg') {
                extension = 'jpeg'
            } 
            const contentType = 'image/' + extension;
            
            const s3_response = await download(uploadedName, bucket);
            const result = await uploadToFirebase(uploadedName, s3_response, contentType);
            console.log('success upload to firebsae, file = ' + uploadedName + ', result = ' + result);
            callback(null);
        } catch (err) {
            console.log('err ', JSON.stringify(err));
            callback(err);
        }
    } else 
        callback(null);
}