const host = 'https://mjc5e825-upload-0-guest.t1pal.com';
const usemmol = true;
const showiob = true;
const showMissing = true;
const showMissingInterval = 7; // minutes
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

class Client {
  constructor(host) {
    this.host = host;
  }

  async getCurrentBg() {
    let success = false;
    let retry = 1;
    let result = { sgv: undefined, direction: undefined };

    while (!success && retry <= 3) {
      try {
        const entries = await this._makeHttpRequest('GET', '/api/v1/entries/sgv?count=1');

        if (!Array.isArray(entries) || entries.length < 1) {
          throw Error('Unsupported response format');
        }

        const entry = entries[0];

        if (!entry.sgv) {
          throw Error('Unsupported response format');
        }

        success = true;

        result = { sgv: entry.sgv, direction: entry.direction };
      } catch (e) {
        log(e);
      } finally {
        retry++;
      }
    }

    return result;
  }

  async getCurrentIOB() {
    let success = false;
    let retry = 1;
    let result = undefined;

    while (!success && retry <= 3) {
      try {
        const entries = await this._makeHttpRequest('GET', '/api/v1/devicestatus?count=1');

        if (!Array.isArray(entries) || entries.length < 1) {
          throw Error('Unsupported response format');
        }

        const entry = entries[0];

        if (!entry.openaps) {
          throw Error('Unsupported response format');
        }

        const openaps = entry.openaps;

        if (!openaps.IOB && !openaps.iob && (openaps.iob && !openaps.iob.iob)) {
          throw Error('Unsupported response format');
        }

        success = true;
        result = openaps.IOB || openaps.iob.iob;
      } catch (e) {
        log(e);
      } finally {
        retry++;
      }
    }

    return result;
  }

  async _makeHttpRequest(method, uri) {
    uri = `${this.host}${uri}`;

    return new Promise((resolve, reject) => {
      log(`Making a ${method} request to ${uri}`);
      const request = Soup.Message.new(method, uri);
      request.request_headers.append('accept', 'application/json');
      _httpSession.queue_message(request, (_httpSession, message) => {
        if (message.status_code === 200) {
          resolve(JSON.parse(message.response_body.data));
        } else {
          log(`Failed to acquire request (${message.status_code})`);
          reject(`Failed to acquire request (${message.status_code})`);
        }
      });
    });
  }
}

class DataProvider {
  constructor(onDataUpdated) {
    this._client = new Client(host);
    this._onDataUpdated = onDataUpdated;

    this.bg = {
      sgv: undefined,
      direction: undefined,
    };
    this._lastBGDate = undefined;
    this._bgMinutesAgo = undefined;
    this._bgInterval = undefined;

    this.iob = undefined;
    this._lastIOBDate = undefined;
    this._iobMinutesAgo = undefined
    this._iobInterval = undefined;

    this._outdatedDetectInterval = undefined;
  }

  start() {
    this._fetchBG();
    this._fetchIOB();

    this._bgInterval = setInterval(() => {
      this._fetchBG();
    }, updatePeriod);

    this._iobInterval = setInterval(() => {
      this._fetchIOB();
    }, updatePeriod);

    this._outdatedDetectInterval = setInterval(() => {
      this._refreshOutdatedData();
    }, updatePeriod);
  }

  stop() {
    clearInterval(this._bgInterval);
    clearInterval(this._iobInterval);
    clearInterval(this._outdatedDetectInterval);
  }

  _fetchBG() {
    this._client.getCurrentBg().then(v => {
      if (!v || !v.sgv){
        return;
      }

      this.bg = v;
      this._lastBGDate = Date.now();
      this._refreshOutdatedData();
      this._triggerUpdate();
    });
  }

  _fetchIOB() {
    this._client.getCurrentIOB().then(v => {
      if (v === undefined) {
        return;
      }

      this.iob = v;
      this._lastIOBDate = Date.now();
      this._refreshOutdatedData();
      this._triggerUpdate();
    });
  }

  _refreshOutdatedData() {
    const currentDate = Date.now();

    const minutesAgo = date => Math.floor((currentDate - date) / 60 / 1000);

    this._bgMinutesAgo = this._lastBGDate ? minutesAgo(this._lastBGDate) : undefined;
    this._iobMinutesAgo = this._lastIOBDate ? minutesAgo(this._lastIOBDate) : undefined;

    if(this._bgMinutesAgo > this.showMissingInterval || this._iobMinutesAgo > this.showMissingInterval) {
      this._triggerUpdate();
    }
  }

  _triggerUpdate() {
    this._onDataUpdated(this.bg.sgv, this.bg.direction, this.iob, this._bgMinutesAgo, this._iobMinutesAgo);
  }
}


class Presenter {
  static print(bg, bgDirectionString, iob, bgMinutesAgo, iobMinutesAgo) {
    const bgMinutesAgoString = bgMinutesAgo ? Presenter._toSubScript(bgMinutesAgo) : '';
    const iobMinutesAgoString = iobMinutesAgo ? Presenter._toSubScript(iobMinutesAgo) : '';
    const bgValue = usemmol ? Presenter._roundUsing(Math.ceil, 1, bg * 0.0555).toFixed(1) : bg;
    const directionGlyph = Presenter._getDirectionGlyph(bgDirectionString);
    const iobString = iob ? `${iob.toFixed(1)}u` : '';

    return `${bgValue}${bgMinutesAgoString}${directionGlyph}${iobString}${iobMinutesAgoString}`;
  }

  static _getDirectionGlyph(direction) {
    const glyphs = {
      Flat: '→',
      FortyFiveUp: '↗',
      FortyFiveDown: '↘',
      SingleDown: '↓',
      DoubleDown: '↓↓',
      TripleDown: '↓↓↓',
      SingleUp: '↑',
      DoubleUp: '↑↑',
      TripleUp: '↑↑↑',
    }


    return glyphs[direction] || '?';
  }

  static _roundUsing(func, prec, value) {
    let temp = value * Math.pow(10, prec)
    temp = func(temp);

    return temp / Math.pow(10, prec)
  }

  static _toSubScript(s) {
    const DIGITS = {
      '0': '₀',
      '1': '₁',
      '2': '₂',
      '3': '₃',
      '4': '₄',
      '5': '₅',
      '6': '₆',
      '7': '₇',
      '8': '₈',
      '9': '₉'
    }

    return String(s).split('').map(function(ch) {
      if(ch in DIGITS) {
        return DIGITS[ch]
      }
      return ch
    }).join('')
  }
}

class Extension {
  constructor() {
    this._indicator = null;
    this._dataProvider = null;
  }

  enable() {
    log(`enabling ${Me.metadata.name}`);
    let indicatorName = `${Me.metadata.name} Indicator`;
    this._indicator = new PanelMenu.Button(0.0, indicatorName, false);
    this.label = new St.Label({ text: '' });
    this._indicator.add_child(this.label);
    Main.panel.addToStatusArea(indicatorName, this._indicator);

    this._dataProvider = new DataProvider((bg, bgDirectionString, iob, bgMinutesAgo, iobMinutesAgo) => {
      this.label.set_text(Presenter.print(bg, bgDirectionString, iob, bgMinutesAgo, iobMinutesAgo));
    });
    this._dataProvider.start();
  }

  disable() {
    log(`disabling ${Me.metadata.name}`);

    this._dataProvider.stop();
    this._dataProvider = null;

    this._indicator.destroy();
    this._indicator = null;
  }
}


function init() {
    log(`initializing ${Me.metadata.name}`);

    return new Extension();
}
