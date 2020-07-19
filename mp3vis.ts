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

async function readlayer3sideinfo(r: U8BitReader, header: PromiseType<ReturnType<typeof readheader>>) {
    const is_mono = header.mode === 3;
    const nchans = is_mono ? 1 : 2;

    const main_data_end = await r.readbits(9); // means this frame needs this more bytes from previous last
    const private_bits = await r.readbits(is_mono ? 5 : 3);
    // note: scfsi just for long windows.
    const scfsi = [];
    for (const ch of times(nchans)) {
        const scfsi_ch = [];
        for (const band of times(4)) { // for bands 0..5, 6..10, 11..15, 16..20 (note: only first is 6 elms not 5!)
            scfsi_ch.push(await r.readbits(1));
        }
        scfsi.push(scfsi_ch);
    }

    const part2_3_length = [];
    const big_values = [];
    const global_gain = [];
    const scalefac_compress = [];
    const block = [];
    const preflag = [];
    const scalefac_scale = [];
    const count1table_select = [];

    for (const gr of times(2)) {
        const part2_3_length_gr = [];
        const big_values_gr = [];
        const global_gain_gr = [];
        const scalefac_compress_gr = [];
        const block_gr = [];
        const preflag_gr = [];
        const scalefac_scale_gr = [];
        const count1table_select_gr = [];
        for (const ch of times(nchans)) {
            part2_3_length_gr.push(await r.readbits(12));
            big_values_gr.push(await r.readbits(9));
            global_gain_gr.push(await r.readbits(8));
            scalefac_compress_gr.push(await r.readbits(4));
            const blocksplit_flag_gr_ch = await r.readbits(1);
            // both are 22bits
            if (blocksplit_flag_gr_ch) {
                // non-normal window
                const block_type_gr_ch = await r.readbits(2);
                const switch_point_gr_ch = await r.readbits(1);
                const table_select_gr_ch = [];
                for (const region of times(2)) {
                    table_select_gr_ch.push(await r.readbits(5));
                }
                const subblock_gain_gr_ch = [];
                for (const window of times(3)) {
                    subblock_gain_gr_ch.push(await r.readbits(3));
                }

                if (block_type_gr_ch === 0) {
                    throw new Error("!reserved:inconsistency-normal-window blocksplit_flag=1 but block_type=0");
                }

                // they from Lagerstrom MP3 Thesis
                const region_address1_gr_ch = (block_type_gr_ch === 2 && switch_point_gr_ch === 0) ? 8 : 7;
                const region_address2_gr_ch = 20 - region_address1_gr_ch;

                block_gr.push({
                    block_split_flag: true, // window_switch?
                    block_type: block_type_gr_ch,
                    switch_point: switch_point_gr_ch, // mixed_block?
                    table_select: table_select_gr_ch,
                    subblock_gain: subblock_gain_gr_ch,
                    region_address1: region_address1_gr_ch,
                    region_address2: region_address2_gr_ch,
                });
            } else {
                // normal window
                const table_select_gr_ch = [];
                for (const region of times(3)) {
                    table_select_gr_ch.push(await r.readbits(5));
                }
                const region_address1_gr_ch = await r.readbits(4);
                const region_address2_gr_ch = await r.readbits(3);

                block_gr.push({
                    block_split_flag: false, // window_switch?
                    block_type: 0,
                    switch_point: null, // mixed_block?
                    table_select: table_select_gr_ch,
                    subblock_gain: null,
                    region_address1: region_address1_gr_ch,
                    region_address2: region_address2_gr_ch,
                });
            }
            preflag_gr.push(await r.readbits(1));
            scalefac_scale_gr.push(await r.readbits(1));
            count1table_select_gr.push(await r.readbits(1));
        }

        part2_3_length.push(part2_3_length_gr);
        big_values.push(big_values_gr);
        global_gain.push(global_gain_gr);
        scalefac_compress.push(scalefac_compress_gr);
        block.push(block_gr);
        preflag.push(preflag_gr);
        scalefac_scale.push(scalefac_scale_gr);
        count1table_select.push(count1table_select_gr);
    }

    return {
        main_data_end,
        private_bits,
        scfsi, // SCaleFactor Selection Information
        part2_3_length,
        big_values,
        global_gain,
        scalefac_compress,
        block,
        preflag,
        scalefac_scale,
        count1table_select,
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
    // note: it seems here becomes byte-boundary. spec carefully made? (using private_bits as padding)

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

// https://stackoverflow.com/a/35633935
function concat<T extends Uint8Array>(a: T, b: T) {
    const x = new (a.constructor as any)(a.length + b.length);
    x.set(a);
    x.set(b, a.length);
    return x;
}

// note: this will return more than enough on tail.
function get_main_data(prevframes: PromiseType<ReturnType<typeof readframe>>[], frame: PromiseType<ReturnType<typeof readframe>>) {
    // ugly but can't flatMap to Uint8Array...
    const reservoir = prevframes.map(f => f.data).reduce((p, c) => concat(p, c), new Uint8Array());
    if (reservoir.length < frame.sideinfo.main_data_end) {
        // not enough reservoir (started in middle of stream?), can't decode
        return null;
    }

    return concat(reservoir.slice(-frame.sideinfo.main_data_end), frame.data);
}

async function decodeframe(prevframes: PromiseType<ReturnType<typeof readframe>>[], frame: PromiseType<ReturnType<typeof readframe>>) {
    const main_data = get_main_data(prevframes, frame);
    if (!main_data) {
        // not enough reservoir (started in middle of stream?), can't decode
        return null;
    }

    // if we readed frame.data this can be non-async.
    const r = new U8BitReader(main_data);
    const is_mono = frame.header.mode === 3;
    const nchans = is_mono ? 1 : 2;
    const scalefac_l = [];
    const scalefac_s = [];
    for (const gr of times(2)) {
        for (const ch of times(nchans)) {
            ;
        }
    }

    return {
        main_data,
    };
}

async function parsefile(ab: ArrayBuffer) {
    const br = new U8BitReader(new Uint8Array(ab));
    const frames = [];
    const maindatas = [];
    while (!br.eof()) {
        const pos = br.tell();
        try {
            frames.push(await readframe(br));
            const framedata = await decodeframe(frames.slice(-3, -1), frames[frames.length - 1]); // recent 3 frames including current.
            if (framedata) {
                maindatas.push(framedata);
            }
        } catch {
            // try next byte, synchronizing to byte
            br.seek(Math.floor(pos / 8 + 1) * 8);
        }
    }
    console.log(frames);
    console.log(maindatas);
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
