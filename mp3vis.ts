// bslbf/uimsbf reader
class U8BitReader {
    constructor(u8) {
        this.u8 = u8;
        this.seek(0);
    }
    async readbits(nbits) {
        let b = 0;
        while (0 < nbits) {
            if (8 <= this.atebits) {
                if (this.eof()) {
                    // return null even if partial read succeeds.
                    return null;
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
    seek(bipos) {
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
const readheader = async (ab) => {
    const syncword = await ab.readbits(12)
    if (syncword !== 0xFFF) {
        throw new Error("!sync");
    }
    const id = await ab.readbits(1); // 1==MPEG_Audio
    if (id === 0) {
        throw new Error("!id");
    }
    const layer = await ab.readbits(2); // 11=layer1 10=layer2 01=layer3
    if (layer === 0) {
        throw new Error("!layer");
    }
    const protection_bit = await ab.readbits(1); // 0=redundancy_added
    const bitrate_index = await ab.readbits(4);
    const sampling_frequency = await ab.readbits(2); // 00=44.1k 01=48k 10=32k
    if (sampling_frequency === 3) {
        throw new Error("!sampfreq");
    }
    const padding_bit = await ab.readbits(1); // 1=padding_added
    const private_bit = await ab.readbits(1);
    const mode = await ab.readbits(2); // 00=stereo 01=joint_stereo(MS/IS) 10=dual_channel 11=single_channel
    const mode_extension = await ab.readbits(2); // Layer3: (msb)MSon|ISon(lsb)
    const copyright = await ab.readbits(1); // 1=copyright_protected
    const original = await ab.readbits(1); // 1=original
    const emphasis = await ab.readbits(2); // 00=noemph 01=50/15us 10=reserved 11=CCITT_J.17
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
const readlayer3audio = async (ab, header) => {

};
const readframe = async (ab) => {
    const offset = ab.tell() / 8;
    const header = await readheader(ab);
    const crc_check = (header.protection_bit === 0) ? await ab.readbits(16) : null;
    if (header.layer != 1) { // layer3
        throw new Error("!not-layer3");
    }
    const audio_data = await readlayer3audio(ab, header);
    return {
        offset,
        header,
        crc_check,
        audio_data,
    };
};
const parsefile = async (ab) => {
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
