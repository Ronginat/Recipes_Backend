const AWS = require('aws-sdk');
const im = require('imagemagick');
const fs = require('fs');

AWS.config.update({region: process.env['REGION']});

const s3 = new AWS.S3();



exports.handler = async (event, context) => {
    try {
        console.log(event);

        context.done();

    } catch(err) {
        console.log("error when generating thumbnail.\n" + err);
        context.done(err);
    }
};