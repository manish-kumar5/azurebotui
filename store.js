var Promise = require('bluebird');
var userdata = require('./userdata.json');

module.exports = {
    validateuser: function (userid, password) {
        var _user;
        for (var i = 0, l = userdata.users.length; i < l; i++) {
            var obj = userdata.users[i];
            if (obj.userid === userid && obj.password === password) {
                _user = obj;
                break;
            }
        }
        return _user;
    },
    validateuseronly: function (userid) {
        var _user;

        for (var i = 0, l = userdata.users.length; i < l; i++) {
            var obj = userdata.users[i];
            if (obj.userid === userid) {
                return obj;
            }
        }
        return _user;
    }
};