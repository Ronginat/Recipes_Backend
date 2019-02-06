const AWS = require('aws-sdk');
const nanoid = require('nanoid');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();


function setResponse(status, body){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
    return response;
}

function dateToString() {
    const date = new Date();
    var day = date.getUTCDate();
    var month = date.getUTCMonth() + 1;
    var year = date.getUTCFullYear();

    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const seconds = date.getUTCSeconds();
    const millis = date.getUTCMilliseconds();

    return '' + year + '-' + (month <= 9 ? '0' + month : month) + '-' + (day <= 9 ? '0' + day : day)
            + ' ' + (hours <= 9 ? '0' + hours : hours) + ':' + (minutes <= 9 ? '0' + minutes : minutes)
            + ':' + (seconds <= 9 ? '0' + seconds : seconds)
            + '.' + (millis <= 10 ? '00' + millis : ( millis <= 100 ? '0' + millis : millis) );
}

function getUsername(token){
    let params = {
        AccessToken: token
    };
    return new Promise((resolve, reject) => {
        cognitoidentityserviceprovider.getUser(params, function(err, data) {
            if (err) {
                console.log(err); // an error occurred
                return reject(err);
            }
            else {
                console.log(data); // successful response
                return resolve(data.Username);
            }    
        });
    });
}

function putRecipeInPendings(recipe, contentFile) {
    const date = dateToString();

    const params = {
        TableName: process.env['PEND_RECIPE_TABLE'],
        Item: {
            'id' : recipe.id,
            'recipeFile': contentFile,
            'name' : recipe.name,
            'description': recipe.description,
            'uploader': recipe.uploader,
            'categories': recipe.categories,
            'creationDate': date
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(params, function(err, data) {
            if (err) {
                console.log("Error recipe PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe PUT", data);
                return resolve(data);
            }
        });
    });
}

function generateContentName(recipe) {
    /* let name = 'recipe', extension = "html";
    return name + "---" + recipe.id + "." + extension; */
    const extension = 'hmtl';
    const rand = Math.floor((1 + Math.random()) * 0x100) // add 3 random characters for the case of modifying a recipe
            .toString(16);
    return recipe.id + "--recipe--" + rand + "." + extension;
}

function signUrl(fileName) {
    const myBucket = process.env['BUCKET'];
    const signedUrlExpireSeconds = 60 * 5; //5 minutes

    let params = {
        Bucket: myBucket,
        Expires: signedUrlExpireSeconds
    };

    params['Key'] =  process.env['CONTENT_FOLDER'] + "/" + fileName;
    return s3.getSignedUrl('putObject', params);
}


exports.handler = async function(event, context, callback) {
    console.log(event);

    let eventBody = JSON.parse(event['body']);
    
    try {
        let results = {};
                           //let username = await getUsername(event['multyValueHeaders']['Authorization'][0]['AccessToken']);
        eventBody['recipe']['uploader'] = await getUsername(event['headers']['Authorization']);
        console.log('username: ' + eventBody['recipe']['uploader']);
        const newId = nanoid(12);
        console.log('generated id = ' + newId);
        eventBody['recipe']['id'] = newId;

        let htmlName = generateContentName(eventBody['recipe']);
        console.log('generated html file name: ' + htmlName);
        let recipeItem = await putRecipeInPendings(eventBody['recipe'], htmlName);  
        //console.log('recipe item in db: \n' + JSON.stringify(recipeItem));
  
        const url = signUrl(htmlName);
        console.log('signed url: ' + url);

        //if (Object.keys(pend.UnprocessedItems).length === 0)

        results['Item'] = recipeItem;
        results['url'] = url;
        
        callback(null, setResponse(200, JSON.stringify(results)));        
    } catch(err) {
        console.log('got error, ' + err)
        callback(null, setResponse(400, err));
    }
};