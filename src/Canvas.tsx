import React from 'react';

// ...or use https://gist.github.com/strothj/708afcf4f01dd04de8f49c92e88093c3
interface ResizeObserverEntry {
    readonly contentRect: DOMRectReadOnly;
}
declare class ResizeObserver {
    constructor(callback: (entries: ResizeObserverEntry[], observer: ResizeObserverEntry) => void);
    observe(target: Element): void;
    disconnect(): void;
}

export type CanvasUserArgs<T> = Omit<CanvasArgs<T>, 'data' | 'onDraw'>;
type CanvasArgs<T> = {
    data: T; // dummy prop to invoke render
    onDraw: (ctx: CanvasRenderingContext2D, data: T) => void;
    onResize?: (width: number, height: number) => void;
} & JSX.IntrinsicElements["canvas"];

// TODO: use devicePixelRatio
export function Canvas<T>({ data, onDraw, onResize, ...props }: CanvasArgs<T>) {
    const refCanvas = React.useRef<HTMLCanvasElement>(null);

    const [size, setSize] = React.useState({ width: 0, height: 0 });

    React.useEffect(() => {
        const canvas = refCanvas.current;

        if (!canvas) {
            return;
        }

        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;

        // https://stackoverflow.com/a/10214971
        canvas.width = width;
        canvas.height = height;

        const sized = (width: number, height: number) => {
            if (width !== size?.width || height !== size?.height) {
                setSize({ width, height });
                onResize?.(width, height);
            }
        };

        sized(width, height);

        const observer = new ResizeObserver(entries => {
            const newRect = entries[0].contentRect;
            sized(newRect.width, newRect.height);
        });
        observer.observe(canvas);
        return () => {
            observer.disconnect();
        };
    }, [onResize, size]);

    React.useEffect(() => {
        const canvas = refCanvas.current;
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }

        onDraw(ctx, data);
    });

    return (<canvas {...props} width="1" height="1" ref={refCanvas} />);
}
