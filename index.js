const yargs = require('yargs'); // Used to make it easier to parse command-line arguments to this script.
const crypto = require('crypto'); // Used to create a JWT associated with your Space.
const { SignJWT } = require('jose/dist/node/cjs/jwt/sign'); // Used to create a JWT associated with your Space.
const { MediaStream, nonstandard: { RTCAudioSource } } = require('wrtc'); // Used to create the `MediaStream` containing your DJ Bot's audio.
const https = require('https');
const decode = require('audio-decode'); // Used to decode the audio file from Audius.
const format = require('audio-format'); // Allows us to retrieve available format properties from an audio-like object, such as our `AudioBuffer`.
const convert = require('pcm-convert'); // Allows us to convert our `AudioBuffer` into the proper `int16` format.
import { Point3D, HiFiAudioAPIData, HiFiCommunicator, preciseInterval } from 'hifi-spatial-audio'; // Used to interface with the Spatial Audio API.

async function generateJWT(id = '') {
    // This is your "App ID" as obtained from the High Fidelity Audio API Developer Console.
    const APP_ID = "";
    // This is your "Space ID" as obtained from the High Fidelity Audio API Developer Console.
    const SPACE_ID = "";
    // This is the "App Secret" as obtained from the High Fidelity Audio API Developer Console.
    const APP_SECRET = "";
    // Used to identify the DJ Bot client as the DJ Bot in your Space.
    const USER_ID = "DJBot" + id;
    let secretKeyForSigning = crypto.createSecretKey(Buffer.from(APP_SECRET, "utf8"));
    let hiFiJWT;
    try {
        hiFiJWT = await new SignJWT({
            "user_id": USER_ID,
            "app_id": APP_ID,
            "space_id": SPACE_ID
        })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .sign(secretKeyForSigning);
    } catch (error) {
        console.error(`Couldn't generate JWT! Error:\
${error}`);
        return;
    }
    return hiFiJWT;
}

/**
 * Play the audio from a file into a High Fidelity Space. The audio will loop indefinitely.
 *
 * @param {string} audioPath - Path to an `.mp3` or `.wav` audio file
 * @param {object} position - The {x, y, z} point at which to spatialize the audio.
 * @param {number} hiFiGain - Set above 1 to boost the volume of the bot, or set below 1 to attenuate the volume of the bot.
 */
async function startDJBot(hiFiGain) {
    let position1 = { x: -50 }
    let position2 = { x: 50 };
    let position3 = { z: -50 };
    let position4 = { z: 50 };
    // Get track from Audius
    const audioFile = await getTrack();

    // Decode the audio file buffer into an AudioBuffer object.
    const audioBuffer = await decode(audioFile),
        // Obtain various necessary pieces of information about the audio file.
        { numberOfChannels, sampleRate, length, duration } = audioBuffer,
        // Get the correct format of the `audioBuffer`.
        parsed = format.detect(audioBuffer),
        // Convert the parsed `audioBuffer` into the proper format.
        convertedAudioBuffer = convert(audioBuffer, parsed, 'int16'),
        // Define the number of bits per sample encoded into the original audio file. `16` is a commonly-used number. The DJ Bot may malfunction
        // if the audio file specified is encoded using a different number of bits per sample.
        BITS_PER_SAMPLE = 16,
        // Define the interval at which we want to fill the sample data being streamed into the `MediaStream` sent up to the Server.
        // `wrtc` expects this to be 10ms.
        TICK_INTERVAL_MS = 10,
        // There are 1000 milliseconds per second :)
        MS_PER_SEC = 1000,
        // The number of times we fill up the audio buffer per second.
        TICKS_PER_SECOND = MS_PER_SEC / TICK_INTERVAL_MS,
        // The number of audio samples present in the `MediaStream` audio buffer per tick.
        SAMPLES_PER_TICK = sampleRate / TICKS_PER_SECOND,
        // Contains the audio sample data present in the `MediaStream` audio buffer sent to the Server.
        currentSamples = new Int16Array(numberOfChannels * SAMPLES_PER_TICK),
        // Contains all of the data necessary to pass to our `RTCAudioSource()`, which is sent to the Server.
        currentAudioData = { samples: currentSamples, sampleRate, 48000: BITS_PER_SAMPLE, channelCount: numberOfChannels, numberOfFrames: SAMPLES_PER_TICK },
        // The `MediaStream` sent to the server consists of an "Audio Source" and, within that Source, a single "Audio Track".
        source1 = new RTCAudioSource(),
        source2 = new RTCAudioSource(),
        source3 = new RTCAudioSource(),
        source4 = new RTCAudioSource(),
        track1 = source1.createTrack(),
        track2 = source2.createTrack(),
        track3 = source3.createTrack(),
        track4 = source4.createTrack(),
        // This is the final `MediaStream` sent to the server. The data within that `MediaStream` will be updated on an interval.
        inputAudioMediaStream1 = new MediaStream([track1]),
        inputAudioMediaStream2 = new MediaStream([track2]),
        inputAudioMediaStream3 = new MediaStream([track3]),
        inputAudioMediaStream4 = new MediaStream([track4]),
        // Define the initial HiFi Audio API Data used when connecting to the Spatial Audio API.
        initialHiFiAudioAPIData = new HiFiAudioAPIData({
            position: new Point3D(position1),
            hiFiGain: hiFiGain,
            userAttenuation: 0.00001
        }),
        initialHiFiAudioAPIData2 = new HiFiAudioAPIData({
            position: new Point3D(position2),
            hiFiGain: hiFiGain,
            userAttenuation: 0.00001
        }),
        initialHiFiAudioAPIData3 = new HiFiAudioAPIData({
            position: new Point3D(position3),
            hiFiGain: hiFiGain,
            userAttenuation: 0.00001
        }),
        initialHiFiAudioAPIData4 = new HiFiAudioAPIData({
            position: new Point3D(position4),
            hiFiGain: hiFiGain,
            userAttenuation: 0.00001
        }),
        // Set up the HiFiCommunicator used to communicate with the Spatial Audio API.
        hifiCommunicator = new HiFiCommunicator({ initialHiFiAudioAPIData: initialHiFiAudioAPIData }),
        hifiCommunicator2 = new HiFiCommunicator({ initialHiFiAudioAPIData: initialHiFiAudioAPIData2 }),
        hifiCommunicator3 = new HiFiCommunicator({ initialHiFiAudioAPIData: initialHiFiAudioAPIData3 }),
        hifiCommunicator4 = new HiFiCommunicator({ initialHiFiAudioAPIData: initialHiFiAudioAPIData4 });
    // Set the Input Audio Media Stream to the `MediaStream` we created above. We'll fill it up with data below.
    await hifiCommunicator.setInputAudioMediaStream(inputAudioMediaStream1);
    await hifiCommunicator2.setInputAudioMediaStream(inputAudioMediaStream2);
    await hifiCommunicator3.setInputAudioMediaStream(inputAudioMediaStream3);
    await hifiCommunicator4.setInputAudioMediaStream(inputAudioMediaStream4);
    // `sampleNumber` defines where we are in the decoded audio stream from above. `0` means "we're at the beginning of the audio file".
    let sampleNumber = 0;
    // Called once every `TICK_INTERVAL_MS` milliseconds.
    let tick = () => {
        // This `for()` loop fills up `currentSamples` with the right amount of raw audio data grabbed from the correct position
        // in the decoded audio file.
        for (let frameNumber = 0; frameNumber < SAMPLES_PER_TICK; frameNumber++, sampleNumber++) {
            for (let channelNumber = 0; channelNumber < numberOfChannels; channelNumber++) {
                currentSamples[frameNumber * numberOfChannels + channelNumber] = convertedAudioBuffer[sampleNumber * numberOfChannels + channelNumber] || 0;
            }
        }

        // This is the function that actually modifies the `MediaStream` we're sending to the Server.
        source1.onData(currentAudioData);
        source2.onData(currentAudioData);
        source3.onData(currentAudioData);
        source4.onData(currentAudioData);

        // Check if we're at the end of our audio file. If so, reset the `sampleNumber` so that we loop.
        if (sampleNumber > length) {
            sampleNumber = 0;
        }
    }

    // Generate the JWT used to connect to our High Fidelity Space.
    let hiFiJWT = await generateJWT();
    let hiFiJWT2 = await generateJWT('2');
    let hiFiJWT3 = await generateJWT('3');
    let hiFiJWT4 = await generateJWT('4');
    if (!hiFiJWT) {
        return;
    }

    // Connect to our High Fidelity Space.
    let connectResponse;
    try {
        connectResponse = await hifiCommunicator.connectToHiFiAudioAPIServer(hiFiJWT);
        await hifiCommunicator2.connectToHiFiAudioAPIServer(hiFiJWT2);
        await hifiCommunicator3.connectToHiFiAudioAPIServer(hiFiJWT3);
        await hifiCommunicator4.connectToHiFiAudioAPIServer(hiFiJWT4);
    } catch (e) {
        console.error(`Call to \`connectToHiFiAudioAPIServer()\` failed! Error:\
${JSON.stringify(e)}`);
        return;
    }

    // Set up the `preciseInterval` used to regularly update the `MediaStream` we're sending to the Server.
    preciseInterval(tick, TICK_INTERVAL_MS);

    console.log(`DJ Bot connected. Let's DANCE!`);
    setTimeout(() => {
        console.log(hifiCommunicator._currentHiFiAudioAPIData.position);
        console.log(hifiCommunicator2._currentHiFiAudioAPIData.position);
        console.log(hifiCommunicator3._currentHiFiAudioAPIData.position);
        console.log(hifiCommunicator4._currentHiFiAudioAPIData.position);
    }, 2000);
}

// Define all of the valid arguments that we can supply to this script on the command line.
const argv = yargs
    .option('audio', {
        describe: 'An audio file path',
        type: 'string',
    })
    .options('x', {
        describe: 'X Coordinate of the bot for spatialized audio',
        type: 'number',
        default: 1
    })
    .options('y', {
        describe: 'Y Coordinate of the bot for spatialized audio',
        type: 'number',
        default: 1
    })
    .options('z', {
        describe: 'Z Coordinate of the bot for spatialized audio',
        type: 'number',
        default: 1
    })
    .options('hiFiGain', {
        describe: 'HiFi Gain for the spatialized audio',
        type: 'number',
        default: 1
    })
    .help()
    .alias('help', 'h')
    .argv;

// Let's dance! 🎶
startDJBot(argv.audio, { x: argv.x, y: argv.y, z: argv.z }, argv.hiFiGain);

/**
 * Currently grabs a specific track from Audius to send to HiFi.
 * @returns A buffer representing the streamed track from Audius
 */
function getTrack() {
    let audioFile = [];
    return new Promise((res, rej) => {
        https.get('https://creatornode.audius.co/tracks/stream/AAJ0K', response => {
            let length = Number(response.headers['content-length']);
            response.on('data', (d) => {
                audioFile.push(d);
            });
            response.on('end', () => {
                res(Buffer.concat(audioFile, length));
            });
        }).on('error', () => {
            rej('Whoops');
        });
    });
}