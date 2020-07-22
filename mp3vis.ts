import { times, range } from "lodash-es";

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
    get length() {
        return this.u8.length * 8;
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

                if (switch_point_gr_ch === 1 && block_type_gr_ch !== 2) {
                    // it seems...
                    throw new Error(`!ReadTheF*ckingSpec: switch_point become 1 only if block_type is 2 but ${block_type_gr_ch}`);
                }

                // they from Lagerstrom MP3 Thesis
                const region_address1_gr_ch = (block_type_gr_ch === 2 && switch_point_gr_ch === 0) ? 8 : 7;
                const region_address2_gr_ch = 20 - region_address1_gr_ch;

                block_gr.push({
                    block_split_flag: true, // window_switch(ing)?
                    block_type: block_type_gr_ch,
                    switch_point: switch_point_gr_ch, // mixed_block?
                    table_select: table_select_gr_ch,
                    subblock_gain: subblock_gain_gr_ch,
                    region_address1: region_address1_gr_ch,
                    region_address2: region_address2_gr_ch,
                } as const);
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
                } as const);
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
        // per frame
        main_data_end, // in "bytes"
        private_bits,

        // per [ch]
        scfsi, // SCaleFactor Selection Information

        // per [gr][ch]
        part2_3_length, // in "bits"
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

const scalefactor_band_indices = {
    44100: {
        long: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576],
        short: [0, 4, 8, 12, 16, 22, 30, 40, 52, 66, 84, 106, 136, 192],
    },
    48000: {
        long: [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576],
        short: [0, 4, 8, 12, 16, 22, 28, 38, 50, 64, 80, 100, 126, 192],
    },
    32000: {
        long: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576],
        short: [0, 4, 8, 12, 16, 22, 30, 42, 58, 78, 104, 138, 180, 192],
    },
} as const;

// from Lagerstrom MP3 Thesis 2.4.3:
//     |------part3_length(huffman bits)------|       |
//     |---------big_value*2---------|        |       |
// [1] | region0 | region1 | region2 | count1 | rzero | [576]
async function readhuffman(r: U8BitReader, frame: PromiseType<ReturnType<typeof readframe>>, part3_length: number, gr: number, ch: number) {
    if (part3_length <= 0) {
        return Array(576).fill(0);
    }

    // not "blocktype==2 and switch_point==true"? really block_split_flag?? its always true if blocktype==2!
    // IIS and Lagerstrom uses block_split_flag.
    // mp3decoder(haskell) completely ignores block_split_flag.
    const is_shortblock = (frame.sideinfo.block[gr][ch].block_type == 2 && frame.sideinfo.block[gr][ch].block_split_flag);
    const sampfreq = ([44100, 48000, 32000] as const)[frame.header.sampling_frequency];
    const region1start = is_shortblock ? 36 : scalefactor_band_indices[sampfreq].long[frame.sideinfo.block[gr][ch].region_address1 + 1];
    // note: mp3decoder(haskell) says "r1len = min ((bigvalues*2)-(min (bigvalues*2) 36)) 540" about 576. that is len, this is start.
    const region2start = is_shortblock ? 576 : scalefactor_band_indices[sampfreq].long[frame.sideinfo.block[gr][ch].region_address1 + frame.sideinfo.block[gr][ch].region_address2 + 2];
}

// ISO 11172-3 2.4.2.7 scalefac_compress
const scalefac_compress_tab = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3], [4, 2], [4, 3]];

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
    const scalefac: ({ type: "switch", scalefac_l: number[], scalefac_s_w: number[][]; } | { type: "short", scalefac_s: number[]; } | { type: "long", scalefac_l: number[]; })[][] = [];
    const samples = [];
    for (const gr of times(2)) {
        const scalefac_gr = [];
        const samples_gr = [];
        for (const ch of times(nchans)) {
            const block_gr_ch = frame.sideinfo.block[gr][ch];
            const scalefac_compress_gr_ch = frame.sideinfo.scalefac_compress[gr][ch];

            const part2_start = r.tell();

            // scale-factors are "part 2"
            const [slen1, slen2] = scalefac_compress_tab[scalefac_compress_gr_ch];
            if (block_gr_ch.block_type === 2) {
                // short-window
                if (block_gr_ch.switch_point) {
                    // long-and-short
                    const scalefac_l = [];
                    for (const band of range(0, 7 + 1)) {
                        scalefac_l[band] = await r.readbits(slen1);
                    }
                    const scalefac_s_w = [];
                    for (const [sfrbeg, sfrend, slen] of [[3, 5, slen1], [6, 11, slen2]]) { // 3..5, 6..11 from Lagerstrom MP3 Thesis and ISO 11172-3 2.4.2.7 switch_point[gr] switch_point_s
                        for (const band of range(sfrbeg, sfrend + 1)) {
                            const scalefac_s_w_band = [];
                            for (const window of times(3)) {
                                scalefac_s_w_band[window] = await r.readbits(slen);
                            }
                            scalefac_s_w[band] = scalefac_s_w_band;
                        }
                    }
                    scalefac_gr.push({
                        type: "switch",
                        scalefac_l,
                        scalefac_s_w,
                    } as const);
                } else {
                    // short
                    const scalefac_s = [];
                    for (const [sfrbeg, sfrend, slen] of [[0, 5, slen1], [6, 11, slen2]]) {
                        for (const band of range(sfrbeg, sfrend + 1)) {
                            scalefac_s[band] = await r.readbits(slen);
                        }
                    }
                    scalefac_gr.push({
                        type: "short",
                        scalefac_s,
                    } as const);
                }
            } else {
                // long-window
                // slen1 for 0..10, slen2 for 11..20
                // ISO 11172-3 2.4.2.7 scfsi_band: 0..5, 6..10, 11..15, 16..20
                const scalefac_l: number[] = [];
                await [[0, 5, slen1], [6, 10, slen1], [11, 15, slen2], [16, 20, slen2]].reduce(async (prev, [sfrbeg, sfrend, slen], group) => {
                    await prev;
                    for (const band of range(sfrbeg, sfrend + 1)) {
                        if (gr === 0 || !frame.sideinfo.scfsi[ch][group]) {
                            scalefac_l[band] = await r.readbits(slen);
                        } else {
                            // copy from granule 0 if gr===1 && scfsi===1
                            if (block_gr_ch.block_type === 2) {
                                throw new Error("scfsi=1 is not allowed if block_type===2 (short window)");
                            }
                            const scalefac_gr0 = scalefac[0][ch];
                            // const scalefac_l_gr0 = (scalefac_gr0 as { scalefac_l: number[]; }).scalefac_l;
                            if (scalefac_gr0.type !== "long") {
                                throw new Error(`BadImpl: window mutated between granule: ${scalefac_gr0}`);
                            }
                            const scalefac_l_gr0 = scalefac_gr0.scalefac_l;
                            scalefac_l[band] = scalefac_l_gr0[band];
                        }
                    }
                }, Promise.resolve());
                scalefac_gr.push({
                    type: "long",
                    scalefac_l,
                } as const);
            }

            const part2_length = r.tell() - part2_start;

            // read huffman "part 3"
            const part3_length = frame.sideinfo.part2_3_length[gr][ch] - part2_length;
            samples_gr.push(await readhuffman(r, frame, part3_length, gr, ch));
        }
        scalefac.push(scalefac_gr);
        samples.push(samples_gr);
    }

    const ancillary_nbits = (8 - r.tell() % 8) % 8;
    const ancillary_bits = await r.readbits(ancillary_nbits);
    const ancillary_bytes = await r.readbytes((r.length - r.tell()) / 8);

    return {
        main_data,

        scalefac,
        samples,

        ancillary_nbits,
        ancillary_bits,
        ancillary_bytes, // some of this are next or next-next frame's main_data.
    };
}

export async function parsefile(ab: ArrayBuffer) {
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
