import { times } from "lodash-es";

// https://log.pocka.io/posts/typescript-promisetype/
type PromiseType<T extends Promise<any>> = T extends Promise<infer P>
    ? P
    : never;

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
    async readbytes(nbytes: number) {
        if (this.atebits !== 8) {
            throw new Error(`not byte boundary tell=${this.tell()}`);
        }
        const nrb = Math.min(this.u8.length - this.bypos - 1, nbytes);
        const bys = this.u8.slice(this.bypos + 1, this.bypos + 1 + nrb);
        this.bypos += nrb;
        if (nrb < nbytes) {
            // even if partial read succeeds.
            throw new Error("!eof");
        }
        return bys;
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
    const syncword = await r.readbits(12);
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

async function readlayer3normalwin(r: U8BitReader) {
    const table_select = [];
    for (const region of times(3)) {
        table_select.push(await r.readbits(5));
    }
    const region_address1 = await r.readbits(4);
    const region_address2 = await r.readbits(3);

    return {
        table_select,
        region_address1,
        region_address2,

        block_type: 0,
    };
}

async function readlayer3nonnormalwin(r: U8BitReader) {
    const block_type = await r.readbits(2);
    const switch_point = await r.readbits(1); // mixed_block?
    const table_select = [];
    for (const region of times(2)) {
        table_select.push(await r.readbits(5));
    }
    const subblock_gain = [];
    for (const window of times(3)) {
        subblock_gain.push(await r.readbits(3));
    }

    if (block_type === 0) {
        throw new Error("!reserved:inconsistency-normal-window blocksplit_flag=1 but block_type=0");
    }

    const region_address1 = (block_type === 2 && switch_point === 0) ? 8 : 7; // from Lagerstrom MP3 Thesis

    return {
        block_type,
        switch_point,
        table_select,
        subblock_gain,

        region_address1,
        region_address2: 20 - region_address1, // from Lagerstrom MP3 Thesis
    };
}

async function readlayer3grparams(r: U8BitReader) {
    const part2_3_length = await r.readbits(12);
    const big_values = await r.readbits(9);
    const global_gain = await r.readbits(8);
    const scalefac_compress = await r.readbits(4);
    const blocksplit_flag = await r.readbits(1); // window_switch?
    const param2 = await (blocksplit_flag ? readlayer3nonnormalwin(r) : readlayer3normalwin(r)); // both are 22bits
    const preflag = await r.readbits(1);
    const scalefac_scale = await r.readbits(1);
    const count1table_select = await r.readbits(1);

    return {
        ...param2,
        part2_3_length,
        big_values,
        global_gain,
        scalefac_compress,
        blocksplit_flag,
        preflag,
        scalefac_scale,
        count1table_select,
    };
}

async function readlayer3sideinfo(r: U8BitReader, header: PromiseType<ReturnType<typeof readheader>>) {
    const is_mono = header.mode === 3;
    const nchans = is_mono ? 1 : 2;

    const main_data_end = await r.readbits(9); // means this frame needs this more bytes from previous last
    const private_bits = await r.readbits(is_mono ? 5 : 3);
    // const scfsi = times(nchans).map((ch) => times(4).map((scfsi_band) => await r.readbits(1)));
    const scfsi = [];
    for (const ch of times(nchans)) {
        const scfsi_ch = [];
        for (const band of times(4)) {
            scfsi_ch.push(await r.readbits(1));
        }
        scfsi.push(scfsi_ch);
    }

    // const params = times(2).map((gr) => {
    //     times(nchans).map((ch) => {
    //         const part2_3_length = await r.readbits(12);
    //         const 
    //         return { }
    //     });
    // });
    const params = [];
    for (const gr of times(2)) {
        const params_gr = [];
        for (const ch of times(nchans)) {
            params_gr.push(await readlayer3grparams(r));
        }
        params.push(params_gr);
    }

    return {
        main_data_end,
        private_bits,
        scfsi,
        params,
    };
};

async function readframe(r: U8BitReader) {
    const offset = r.tell() / 8;
    const header = await readheader(r);
    const crc_check = (header.protection_bit === 0) ? await r.readbits(16) : null;
    if (header.layer != 1) { // layer3
        throw new Error("!not-layer3");
    }
    const sideinfo = await readlayer3sideinfo(r, header);
    if (header.bitrate_index === 0) {
        throw new Error("free-format not supported yet");
    }
    const headbytes = r.tell() / 8 - offset;
    const l3bitratekbps = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][header.bitrate_index - 1];
    const sampfreq = [44100, 48000, 32000][header.sampling_frequency];
    // TODO: how to measure framebytes in free-format? try to read next sync and then read?? difficult on buffering...
    // const framebytes = sampfreq/1152/* 2granules */;
    const framebytes = Math.floor(144 * l3bitratekbps * 1000 / sampfreq) + header.padding_bit; // from Lagerstrom MP3 Thesis, but what is 144?
    const data = await r.readbytes(framebytes - headbytes);
    return {
        offset,
        header,
        crc_check,
        sideinfo,
        data, // not main_data that is reassembled.
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
            // try next byte, synchronizing to byte
            br.seek(Math.floor(pos / 8 + 1) * 8);
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
        file.arrayBuffer().then(parsefile);
    }
});
fetch("ah.mp3").then((r) => {
    if (r.ok) {
        r.arrayBuffer().then(parsefile);
    }
});
