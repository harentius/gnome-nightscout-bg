const host = 'https://mjc5e825-upload-0-guest.t1pal.com';
const usemmol = true;
const showiob = true;
const showMissing = true;
const showMissingInterval = 16; // minutes
const updatePeriod = 4*60*1000;

// =================================================================

const St = imports.gi.St;
const Gio = imports.gi.Gio;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const Soup = imports.gi.Soup;

const _httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());

const roundUsing = function(func, prec, value){
  var temp = value * Math.pow(10, prec)
  temp = func(temp);
  return temp / Math.pow(10, prec)
}

class Extension {
    constructor() {
        this._indicator = null;
    }
    
    enable() {
        log(`enabling ${Me.metadata.name}`);

        let indicatorName = `${Me.metadata.name} Indicator`;
        
        // Create a panel button
        this._indicator = new PanelMenu.Button(0.0, indicatorName, false);
        
        this.label = new St.Label({
          text: '',
        });
        this._indicator.add_child(this.label);
        
        this.updateUI();
        setInterval(() => {
          this.updateUI();
        }, updatePeriod);


        // `Main.panel` is the actual panel you see at the top of the screen,
        // not a class constructor.
        Main.panel.addToStatusArea(indicatorName, this._indicator);
    }

    updateUI() {
      try {
        Promise.all([this.requestCurrentBg(), this.requestDeviceStatus()]).then(values => {
          if(!this.last) {
            this.last = values[0];
          }

          this.makeBGstring(values[0], values[1]);
          
          if(values[0] && values[0]._id && (this.last._id !== values[0]._id)) {
            this.last = values[0];
          }
        });
  
      } catch (e) {
        log(e);
      }
    }

    makeBGstring(current, status) {
      let bgString  = "";
      log(status["openaps"]["iob"]["iob"]);
      const bgValue = usemmol ? roundUsing(Math.ceil, 1, current.sgv * 0.0555).toFixed(1) : current.sgv;
      bgString += bgValue;
      switch(current.direction) {
        case 'Flat':
          bgString += ' →';
          break;
        case 'FortyFiveUp':
          bgString += ' ⬈';
          break;
        case 'FortyFiveDown':
          bgString += ' ⬊';
            break;
        case 'SingleDown':
          bgString += ' ↓';
          break;
        case 'DoubleDown':
          bgString += ' ↓↓';
          break;
        case 'TripleDown':
          bgString += ' ↓↓↓';
          break;
        case 'SingleUp':
          bgString += ' ↑';
          break;
        case 'DoubleUp':
          bgString += ' ↑↑';
          break;
        case 'TripleUp':
          bgString += ' ↑↑↑';
          break;
        default:
          break;
      }
      
      if(showiob) {
        try {
          const iob = status["openaps"]["iob"]["iob"];
          bgString += iob.toFixed(1) + 'u';
          // bgString += "  (IoB: " + status.pump.iob.bolusiob + "U)";
        } catch (e) {
          log(e);
        }
      }
      
      if(showMissing && this.last) {
        const lastDate = this.last.date;
        const currentDate = Date.now();
        const minutesAgo = Math.floor((currentDate - lastDate) / 60 / 1000);
        if(minutesAgo > showMissingInterval) {
          bgString = "!Last " + minutesAgo + " m ago!   " + bgString;
        }
      }
      this.label.set_text(bgString);

    }
    
    requestCurrentBg() {
      return this.makeHttpRequest('GET', `${host}/api/v1/entries/current`, (resolve, message) => {
        let current = {};
        log('Requested current state' + message.response_body.data);
        const entries = JSON.parse(message.response_body.data);
        if(entries.length > 0) {
          current = entries[0];
        }
        resolve(current)
      });
    }
    
    requestDeviceStatus() {
      return this.makeHttpRequest('GET', `${host}/api/v1/devicestatus?count=1`, (resolve, message) => {
        let status = {};
        log('Requested device status' + message.response_body.data);
        const statuses = JSON.parse(message.response_body.data);
        if(statuses.length > 0) {
          status = statuses[0];
        }
        resolve(status);
      });
    }
    
    makeHttpRequest(method, uri, cb) {
      uri = uri.replace(/([^:])\/{2,}/, '$1/');
      return new Promise((resolve, reject) => {
        log(`Making a ${method} request to ${uri}`);
        const request = Soup.Message.new(method, uri);
        request.request_headers.append('accept', 'application/json');
        _httpSession.queue_message(request, (_httpSession, message) => {
          if (message.status_code === 200) {
            cb(resolve, message);
          } else {
            log(`Failed to acquire request (${message.status_code})`);
            reject(`Failed to acquire request (${message.status_code})`);
          }
        });
      });
    }

    disable() {
      log(`disabling ${Me.metadata.name}`);

      this._indicator.destroy();
      this._indicator = null;
  }
}


function init() {
    log(`initializing ${Me.metadata.name}`);
    
    return new Extension();
}
