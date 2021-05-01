const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');

const PORT = process.env.PORT || 8888;

const formattedCreds = {
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI,
};

const scopes = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
];

const spotifyApi = new SpotifyWebApi(formattedCreds);
const app = express();

const allowCrossDomain = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
};

app.use(allowCrossDomain);
app.use(express.json());

const accessToken = (user) => new Promise((resolve, reject) => {
  const userObj = JSON.parse(user);
  const api = new SpotifyWebApi(formattedCreds);
  // if the token is not expired set it
  if (userObj.expiresAt - new Date().getTime() > 0) {
    resolve(userObj.accessToken);
  } else { // token is expired
    api.setAccessToken(userObj.accessToken);
    api.setRefreshToken(userObj.refreshToken);
    api.refreshAccessToken()
      .then((data) => {
        resolve(data.body.access_token);
      })
      .catch((err) => {
        reject(err);
      });
  }
});

// use the Spotify api with the access token
const apiWithToken = (token) => {
  const api = new SpotifyWebApi(formattedCreds);
  api.setAccessToken(token);
  return api;
};

app.get('/', (req, res) => {
  res.send('Working at base endpoint: "/"');
});

// Sends the auth URL to the frontend to be used for authorization
app.get('/get-auth-url', (req, res) => {
  const authURL = spotifyApi.createAuthorizeURL(scopes);
  res.send(authURL);
});

// authorize user
app.get('/authorize', (req, res) => {
  spotifyApi
    .authorizationCodeGrant(req.query.code)
    .then((data) => {
      res.send(data);
    })
    .catch((err) => {
      res.status(401).send('Unauthorized!', err);
    });
});

// api to fetch all user data
// user info, playlists
app.get('/user', async (req, res) => {
  const token = await accessToken(req.query.credentials);
  const { page } = req.query;
  const offset = page * 20;
  const api = apiWithToken(token);
  // get basic account info
  api.getMe()
    .then((userRes) => {
      const userData = userRes.body;
      // get playlists
      api.getUserPlaylists({ offset })
        .then((playlistRes) => {
          const playlists = playlistRes.body;
          res.send({
            userInfo: userData,
            userPlaylists: playlists,
          });
        });
    })
    .catch((err) => {
      res.status(404).send('Not found!', err);
    });
});

// get audio features
app.get('/features', async (req, res) => {
  const token = await accessToken(req.query.credentials);
  const api = apiWithToken(token);

  const { playlistIds } = req.query;
  const splitPlaylistIds = playlistIds.split(',');

  const playlistsPromises = splitPlaylistIds.map((playlistId) => api.getPlaylistTracks(playlistId));

  Promise.all(playlistsPromises)
    .then((tracksRes) => {
      const trackIds = tracksRes.map((response) => {
        const { body } = response;
        const { items } = body;
        return items.map((item) => item.track.id);
      });
      const flattenedMap = trackIds.flat().slice(0, 99); // can only take 100 tracks at a time
      api.getAudioFeaturesForTracks(flattenedMap)
        .then((featureRes) => {
          const features = featureRes.body;
          res.send({
            trackFeatures: features,
          });
        }).catch(() => res.status(400).send('Error getting track features.'));
    })
    .catch(() => {
      res.status(404).send('Error on overall /features request');
    });
});

app.get('/createPlaylist', async (req, res) => {
  const token = await accessToken(req.query.credentials);
  const api = apiWithToken(token);

  const { playlistName, tracks } = req.query;

  const tracksArray = tracks.split(',');

  api.getMe()
    .then((userRes) => {
      const { id } = userRes.body;
      api.createPlaylist(id, playlistName)
        .then((playlistRes) => {
          const { id: playlistId } = playlistRes.body;
          api.addTracksToPlaylist(playlistId, tracksArray)
            .then(() => {
              api.getPlaylist(playlistId)
                .then((retrievedPlaylistRes) => {
                  res.send({
                    retrievedPlaylist: retrievedPlaylistRes.body,
                  });
                });
            });
        });
    })
    .catch((err) => {
      res.status(404).send(err);
    });
});

app.listen(PORT, () => {
  console.log('API listening on port', PORT);
});
