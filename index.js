



const yargs = require('yargs'); // Used to make it easier to parse command-line arguments to this script.
const crypto = require('crypto'); // Used to create a JWT associated with your Space.
const { SignJWT } = require('jose/dist/node/cjs/jwt/sign'); // Used to create a JWT associated with your Space.
const { MediaStream, nonstandard: { RTCAudioSource } } = require('wrtc'); // Used to create the `MediaStream` containing your DJ Bot's audio.
const fs = require('fs'); // Used to read the specified audio file from your local disk.
const path = require('path'); // Used to verify that the specified audio file is an MP3 or WAV file.
const decode = require('audio-decode'); // Used to decode the audio file present on your local disk.
const format = require('audio-format'); // Allows us to retrieve available format properties from an audio-like object, such as our `AudioBuffer`.
const convert = require('pcm-convert'); // Allows us to convert our `AudioBuffer` into the proper `int16` format.
import { Point3D, HiFiAudioAPIData, HiFiCommunicator, preciseInterval } from 'hifi-spatial-audio'; // Used to interface with the Spatial Audio API.
import { showCompletionScript } from 'yargs';

/**
 * Play the audio from a file into a High Fidelity Space. The audio will loop indefinitely.
 *
 * @param {string} audioPath - Path to an `.mp3` or `.wav` audio file
 * @param {object} position - The {x, y, z} point at which to spatialize the audio.
 * @param {number} hiFiGain - Set above 1 to boost the volume of the bot, or set below 1 to attenuate the volume of the bot.
 */
async function startDJBot(audioPath, position, hiFiGain) {
    // Make sure we've been passed an `audioPath`...
    if (!audioPath) {
        console.error(`Audio file path not specified! Please specify an audio path with "--audio "`);
        return;
    }

    // Make sure the `audioPath` we've been passed is actually a file that exists on the filesystem...
    if (!fs.statSync(audioPath).isFile()) {
        console.error(`Specified path "${audioPath}" is not a file!`);
        return;
    }

    // Make sure that the file at `audioPath` is a `.mp3` or a `.wav` file.
    let audioFileExtension = path.extname(audioPath).toLowerCase();
    if (!(audioFileExtension === ".mp3" || audioFileExtension === ".wav")) {
        console.error(`Specified audio file must be a \`.mp3\` or a \`.wav\`!\
Instead, it's a \`${audioFileExtension}\``);
        return;
    }

    // Read the audio file from our local filesystem into a file buffer.
    const fileBuffer = fs.readFileSync(audioPath),
        // Decode the audio file buffer into an AudioBuffer object.
        audioBuffer = await decode(fileBuffer),
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
        currentAudioData = { samples: currentSamples, sampleRate, bitsPerSample: BITS_PER_SAMPLE, channelCount: numberOfChannels, numberOfFrames: SAMPLES_PER_TICK },
        // The `MediaStream` sent to the server consists of an "Audio Source" and, within that Source, a single "Audio Track".
        source = new RTCAudioSource(),
        track = source.createTrack(),
        // This is the final `MediaStream` sent to the server. The data within that `MediaStream` will be updated on an interval.
        inputAudioMediaStream = new MediaStream([track]),
        // Define the initial HiFi Audio API Data used when connecting to the Spatial Audio API.
        initialHiFiAudioAPIData = new HiFiAudioAPIData({
            position: new Point3D(position),
            hiFiGain: hiFiGain
        }),
        // Set up the HiFiCommunicator used to communicate with the Spatial Audio API.
        hifiCommunicator = new HiFiCommunicator({ initialHiFiAudioAPIData });

    // Set the Input Audio Media Stream to the `MediaStream` we created above. We'll fill it up with data below.
    await hifiCommunicator.setInputAudioMediaStream(inputAudioMediaStream);

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
        source.onData(currentAudioData);

        // Check if we're at the end of our audio file. If so, reset the `sampleNumber` so that we loop.
        if (sampleNumber > length) {
            sampleNumber = 0;
        }
    }

    // Generate the JWT used to connect to our High Fidelity Space.
    let hiFiJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhcHBfaWQiOiJjMzBjZWQ2Yi0xODU1LTQ0OTYtYjRjNS02MzE3ZTZkNThmOTEiLCJ1c2VyX2lkIjoidCIsInNwYWNlX2lkIjoiNmRkNThmMjQtNDBjZi00YzcyLWE0NmEtZjRkNThmYjVkZTA4Iiwic3RhY2siOiJhdWRpb25ldC1taXhlci1hcGktc3RhZ2luZy0xOCJ9.vEfk8_8EZDO2wc_32L51alS1Mms-EBqaIlxYQrie5cs';
    if (!hiFiJWT) {
        return;
    }

    // Connect to our High Fidelity Space.
    let connectResponse;
    try {
        connectResponse = await hifiCommunicator.connectToHiFiAudioAPIServer(1, hiFiJWT, 'api-staging.highfidelity.com')
            .then((data) => {
                console.log("_______________DATA 1________________", data);
            });
    } catch (e) {
        console.warn(`--------------------FIRST TRY FAILED!`);
        console.log("____________RESPONSE 1___________________", e);
        try { /* second attempt */
            connectResponse = await hifiCommunicator.connectToHiFiAudioAPIServer(2, hiFiJWT, 'api-staging.highfidelity.com')
                .then((data) => {
                    console.log("__________DATA 2_____________________", data);
                });
        } catch (e) {
            console.warn(`--------------------SECOND TRY FAILED!`);
            console.log("____________RESPONSE 2___________________", e);
            return;
        }
    }

    // Set up the `preciseInterval` used to regularly update the `MediaStream` we're sending to the Server.
    preciseInterval(tick, TICK_INTERVAL_MS);

    console.log(`DJ Bot connected. Let's DANCE!`);
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

