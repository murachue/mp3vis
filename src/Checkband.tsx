import React, { useState } from 'react';

export function Checkband({ checks, onChanged }: { checks: boolean[]; onChanged: (values: boolean[]) => void; }) {
    const [prev, setPrev] = useState(null as number | null);

    // note: onchange cannot read event.shiftKey
    const onClickGen = (i: number) => function (ev: React.MouseEvent<HTMLInputElement, MouseEvent>) {
        const newChecks = [...checks];
        const isBulk = prev !== null && ev.shiftKey;
        const from = isBulk ? Math.min(prev!, i) : i;
        const to = isBulk ? Math.max(prev!, i) : i;
        const tobe = !checks[i];
        newChecks.fill(tobe, from, to + 1);
        onChanged(newChecks);
        setPrev(i);
    };

    return (<div>
        {checks.map((checked, i) => <input type="checkbox" checked={checked} onChange={() => { /* delegated to onCheck */ }} onClick={onClickGen(i)} key={i} />)}
    </div>);
}
