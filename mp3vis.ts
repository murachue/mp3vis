import { times } from "lodash-es";

// https://log.pocka.io/posts/typescript-promisetype/
type PromiseType<T extends Promise<any>> = T extends Promise<infer P>
    ? P
    : never

// bslbf/uimsbf reader
class U8BitReader {
    u8: Uint8Array;
    atebits: number;
    bits: number;
    bypos: number;

    constructor(u8: Uint8Array) {
        this.u8 = u8;
        // tsc does not recognize if using #seek. or calling method in ctor is invalid?
        // this.seek(0);
        this.bypos = -1;
        this.atebits = 8;
        this.bits = 0;
    }
    async readbits(nbits: number) {
        let b = 0;
        while (0 < nbits) {
            if (8 <= this.atebits) {
                if (this.eof()) {
                    // even if partial read succeeds.
                    throw new Error("!eof");
                }
                this.bypos += 1;
                this.bits = this.u8[this.bypos];
                this.atebits = 0;
            }
            const r = Math.min(8 - this.atebits, nbits);
            b = (b << r) | ((this.bits >> (8 - r - this.atebits)) & ((1 << r) - 1));
            this.atebits += r;
            nbits -= r;
        }
        return b;
    }
    seek(bipos: number) {
        bipos = Math.min(bipos, this.u8.length * 8);
        this.bypos = Math.floor(bipos / 8);
        this.atebits = bipos % 8;
        if (this.atebits === 0) {
            this.atebits = 8;
            this.bypos = this.bypos - 1;
        }
        this.bits = this.u8[this.bypos];
    }
    tell() {
        return this.bypos * 8 + this.atebits;
    }
    eof() {
        return this.u8.length <= this.bypos + 1;
    }
}

async function readheader(r: U8BitReader) {
    const syncword = await r.readbits(12)
    if (syncword !== 0xFFF) {
        throw new Error("!sync");
    }
    const id = await r.readbits(1); // 1==MPEG_Audio
    if (id === 0) {
        throw new Error("!id");
    }
    const layer = await r.readbits(2); // 11=layer1 10=layer2 01=layer3
    if (layer === 0) {
        throw new Error("!layer");
    }
    const protection_bit = await r.readbits(1); // 0=redundancy_added
    const bitrate_index = await r.readbits(4);
    const sampling_frequency = await r.readbits(2); // 00=44.1k 01=48k 10=32k
    if (sampling_frequency === 3) {
        throw new Error("!sampfreq");
    }
    const padding_bit = await r.readbits(1); // 1=padding_added
    const private_bit = await r.readbits(1);
    const mode = await r.readbits(2); // 00=stereo 01=joint_stereo(MS/IS) 10=dual_channel 11=single_channel
    const mode_extension = await r.readbits(2); // Layer3: (msb)MSon|ISon(lsb)
    const copyright = await r.readbits(1); // 1=copyright_protected
    const original = await r.readbits(1); // 1=original
    const emphasis = await r.readbits(2); // 00=noemph 01=50/15us 10=reserved 11=CCITT_J.17
    if (emphasis === 2) {
        throw new Error("!emph");
    }

    return {
        syncword,
        id,
        layer,
        protection_bit,
        bitrate_index,
        sampling_frequency,
        padding_bit,
        private_bit,
        mode,
        mode_extension,
        copyright,
        original,
        emphasis,
    };
};

async function readlayer3audio(r: U8BitReader, header: PromiseType<ReturnType<typeof readheader>>) {
    // mode != single
    const main_data_end = await r.readbits(9);
    const private_bits = await r.readbits(3);
    const scfsi = times(2).map(() => times(4).map(() => r.readbits(1)));
};

async function readframe(r: U8BitReader) {
    const offset = r.tell() / 8;
    const header = await readheader(r);
    const crc_check = (header.protection_bit === 0) ? await r.readbits(16) : null;
    if (header.layer != 1) { // layer3
        throw new Error("!not-layer3");
    }
    const audio_data = await readlayer3audio(r, header);
    return {
        offset,
        header,
        crc_check,
        audio_data,
    };
};

async function parsefile(ab: ArrayBuffer) {
    const br = new U8BitReader(new Uint8Array(ab));
    const frames = [];
    while (!br.eof()) {
        const pos = br.tell();
        try {
            frames.push(await readframe(br));
        } catch {
            // try next byte
            br.seek(pos + 8);
        }
    }
    console.log(frames);
};


// TODO move to html, to do that we must find export parsefile() by webpack to be able to dynamic import().parsefile
const it = document.getElementById("dropbox")!;
it.addEventListener("dragover", (e) => {
    e.preventDefault();
});
it.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
        file.arrayBuffer().then(parsefile)
    }
});
fetch("Little.mp3").then((r) => {
    if (r.ok) {
        r.arrayBuffer().then(parsefile);
    }
});
