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

export function Canvas<T>({ data, onDraw, ...props }: {
    data: T; // dummy prop to invoke render
    onDraw: (ctx: CanvasRenderingContext2D) => void;
} & JSX.IntrinsicElements["canvas"]) {
    const refCanvas = React.createRef<HTMLCanvasElement>();

    const [size, setSize] = React.useState<DOMRectReadOnly>();

    React.useEffect(() => {
        const canvas = refCanvas.current;

        if (!canvas) {
            return;
        }

        // https://stackoverflow.com/a/10214971
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        const observer = new ResizeObserver(entries => {
            const newRect = entries[0].contentRect;
            if (newRect.width !== size?.width || newRect.height !== size?.height) {
                setSize(newRect);
            }
        });
        observer.observe(canvas);
        return () => {
            observer.disconnect();
        };
    }, [size]);

    React.useEffect(() => {
        const canvas = refCanvas.current;
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }

        onDraw(ctx);
    });

    return (<canvas {...props} width="1" height="1" ref={refCanvas} />);
}
