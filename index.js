var Swagger = require('swagger-client');
var open = require('open');
var rp = require('request-promise');
var store = require('./store');
var http = require('http');
var express = require('express');
var session = require('express-session');

// config items
var pollInterval = 1000;
var directLineSecret = 'Gi0llUgs4G4.cwA.g9w.mUtbQC_Md9okZ3BmMPMRM0wCdPOlhq0F_F6oS112YlY';
var directLineClientName = 'mercerpocbotmar_1';
var directLineSpecUrl = 'https://docs.botframework.com/en-us/restapi/directline3/swagger.json';
var path = __dirname + '/views/';

var _client, _conversationId, watermark = 0;
var refreshIntervalId;//, prev_msg_id=0, curr_msg_id=0;

var app = express();

app.use(session({
    secret: 'somesecrettokenhere', resave: false,
    saveUninitialized: true, cookie: { maxAge: 1200000 }
}))

//*** Defining api router
var webchatRouter = express.Router();
app.use('/bot', webchatRouter);

webchatRouter.route('/user/:userid/:pwd')
.post(function (req, res) {
    var sess = req.session;
    var userid = req.params.userid;
    var pwd = req.params.pwd;
    var user = store.validateuser(userid, pwd);
    if (user) {
        sess.username = user.name;
        res.json({ success: true, username: sess.username, dob: user.dob, ssn: user.ssn, address: user.address, cert: user.certno, telephone: user.phone })
    } else {
        res.json({ success: false });
    }
});

// webchatRouter.route('/user/:userid/:certno/:dob/:addr/:tele/:ssn')
webchatRouter.route('/userdetails/:username/:certno/:dob/:telephone/:ssn')
.post(function (req, res) {
    var sess = req.session;
    var userid = req.params.username;

    // console.log('user details route');

    var isValidSsn = false;

    var user = store.validateuseronly(userid);

    // console.log('user->' + user);

    if (user) {
        // console.log('user details route-> Found User');
        sess.username = user.name;

        if (req.params.ssn) {
            var storedSsnLast4Digits = user.ssn.substr(user.ssn.length - 4);
            isValidSsn = (req.params.ssn === storedSsnLast4Digits);
        }

        //console.log('IsValidSsn->' + isValidSsn);
        //console.log(req.params.dob + ':' + req.params.telephone + ':' + req.params.certno);

        if (isValidSsn && user.dob === req.params.dob && user.phone === req.params.telephone && user.certno === req.params.certno) {
            //console.log('user details route - > User found -> Details match');
            res.json({ success: true });
        }
        else {
            //console.log('user details route - > User found -> Details mismatch');
            res.json({ success: false });
        }
    }
    else {
        //console.log('user details route - > User not found');
        res.json({ success: false });
    }
});

webchatRouter.route('/paymentdetails/:cardno/:expirymonth/:expiryyear')
.post(function (req, res) {
    var sess = req.session;

    var cardNo = req.params.cardno;
    var expiryMonth = req.params.expirymonth;
    var expiryYear = req.params.expiryyear;

    if (cardNo && expiryMonth && expiryYear) {
        res.json({ success: true });
    }
    else {
        res.json({ success: false });
    }
});

webchatRouter.route('/webchat')
.get(function (req, res) {
    res.sendFile(path + "webchat.html");
});

webchatRouter.route('/post/:message')
.get(function (req, res) {
    var sess = req.session;
    var conversation = sess.conversation;
    var watermark = sess.watermark;
    var message = req.params.message;
    console.log(message);
    rp(directLineSpecUrl)
    .then(function (spec) {
        // client
        return new Swagger({
            spec: JSON.parse(spec.trim()),
            usePromise: true
        });
    })
    .then(function (client) {
        // add authorization header to client
        client.clientAuthorizations.add('AuthorizationBotConnector', new Swagger.ApiKeyAuthorization('Authorization', 'Bearer ' + directLineSecret, 'header'));
        //return client;
        if (!conversation) {
            //console.log("Initializing New Conversation");
            client.Conversations.Conversations_StartConversation()                          // create conversation
            .then(function (response) {
                //console.log("New conversation id: " + response.obj.conversationId);
                sess.conversation = response.obj;
                refreshIntervalId = setInterval(function () {
                    client.Conversations.Conversations_GetActivities({ conversationId: sess.conversation.conversationId, watermark: sess.watermark })
                        .then(function (response) {
                            sess.watermark = response.obj.watermark;
                            //console.log("Watermark set to :" + sess.watermark);
                            // use watermark so subsequent requests skip old messages 
                            printMessages(response.obj.activities, message, res);
                        });
                }, 1000);
            });
        } else {
            client.Conversations.Conversations_PostActivity(
            {
                conversationId: sess.conversation.conversationId,
                activity: {
                    textFormat: 'plain',
                    text: message,
                    type: 'message',
                    from: {
                        id: sess.conversation.conversationId,
                        name: sess.username + '-' + sess.conversation.conversationId
                    }
                }
            })
                .then(function (spec) {
                    refreshIntervalId = setInterval(function () {
                        //console.log("calling retry: " + sess.conversation.conversationId);
                        //console.log("watermark: " + sess.watermark);
                        client.Conversations.Conversations_GetActivities({ conversationId: sess.conversation.conversationId, watermark: sess.watermark })
                            .then(function (response) {
                                sess.watermark = response.obj.watermark;    // use watermark so subsequent requests skip old messages 
                                printMessages(response.obj.activities, message, res);
                            });
                    }, 1000);
                })
                .catch(function (err) {
                    console.error('Error sending message:', err);
                    res.json({ result: "error", error_msg: 'Error sending message:', err });
                });
        }
    })
    .catch(function (err) {
        console.error('Error initializing DirectLine client', err);
        res.json({ result: "error", error_msg: 'Error sending message:', err });
    });

});

// Helpers methods
function printMessages(activities, message, res) {
    //console.log("Print Message Called");
    if (activities && activities.length) {

        // ignore own messages
        activities = activities.filter(function (m) { return m.from.id !== directLineClientName });
        //console.log(activities);
        
        //console.log("Activities: " + activities.length);
        var response = "";
        if (activities.length) {
            
            for (var i = 0; i < activities.length; i++) {
                //var curr_msg_id = getMsgId(activities[i].id);
                //if(curr_msg_id > prev_msg_id){
                //console.log(curr_msg_id);
                response += printMessage(activities[i], res);
                //}
            }
            //if(curr_msg_id > prev_msg_id)
            //{
            //console.log(response);

            //    prev_msg_id = curr_msg_id;
            //   clearInterval(refreshIntervalId);
            //}
        }
        if ("<p>" + message + "</p>" == response) {
            //console.log("this is request message")
        //} 
        //if(response.indexOf("<p>" + message + "</p>") > -1){
            //
        }else {
            response.replace(message, '');
            res.json({ data: response });
        }
    }
}

function printMessage(activity, res) {

    var response = "";
    if (activity.text) {
        if (activity.text.length > 0)
            response += '<p>' + activity.text + '</p>';
    }

    if (activity.attachments) {
        activity.attachments.forEach(function (attachment) {
            switch (attachment.contentType) {
                case "application/vnd.microsoft.card.hero":
                    response += renderHeroCard(attachment, res);
                    break;

                case "image/png":
                    //console.log('Opening the requested image ' + attachment.contentUrl);
                    open(attachment.contentUrl);
                    break;
            }
        });
    }
    return response;
}



function renderHeroCard(attachment, res) {
    var htmltext = "";
    /*if(attachment.content.images){
        htmltext += '<img style="height:60px;width:60px;" src="' + attachment.content.images[0].url + '"></img>';
    }*/
    if (attachment.content.title) {
        htmltext += '<h4>' + attachment.content.title + '</h4>';
    }

    if (attachment.content.subtitle) {
        htmltext += '<p>' + attachment.content.subtitle + '</p>';
    }
    if (attachment.content.buttons && attachment.content.buttons.length) {
        attachment.content.buttons.forEach(function (button) {
            htmltext += '<input type="button" onclick="hello(this)" value="' + button.title + '" id="' + button.value + '">'
            //htmltext += '<button onclick="javascript:hello()" id="' + button.value + '"  class="btn btn-info" style="width:100px;vertical-align: center;"><span class="glyphicon glyphicon-ok"></span>' + button.value + ' </button>&nbsp;&nbsp;';
        });
    }
    htmltext += "<br>";
    return htmltext;
}

app.use(express.static(__dirname));
//var port = process.env.PORT || 8000;
var port = 5001;
app.listen(port, function () {
    console.log("App is running on port " + port);
});