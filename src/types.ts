import { parsefile, PromiseType } from './libmp3';

export type MyParsed = Omit<PromiseType<ReturnType<typeof parsefile>>, "soundframes"> & {
    sounds: number[][];
    framerefs: {
        main_i: number;
        maindata: PromiseType<ReturnType<typeof parsefile>>["maindatas"][number];
        offset: number;
        size: number;
    }[][];
};
