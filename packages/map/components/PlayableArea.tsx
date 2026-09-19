import { memo, useEffect, useMemo, useState } from "react";
import { Polyline, Tooltip, useMap } from "react-leaflet";

import { useSelectedTrain } from "../contexts/SelectedTrainContext";
import {
	getLineLabels,
	getPlayableAreaSegments,
	ROUTE_COLORS,
} from "../lib/trainRoute";

const ACTIVE_COLOR = "#3388ff";
const HIGHLIGHT_PALETTE = [
	"#f1c40f",
	"#e91e63",
	"#9b59b6",
	"#e67e22",
	"#1abc9c",
	"#3498db",
	"#2ecc71",
	"#e74c3c",
];

const PlayableArea = () => {
	const { selectedTrain, showTrainRoute } = useSelectedTrain();
	const segments = useMemo(() => getPlayableAreaSegments(), []);
	const [hoveredLine, setHoveredLine] = useState<string | null>(null);
	const [selectedLine, setSelectedLine] = useState<string | null>(null);
	const activeLine = hoveredLine ?? selectedLine;
	const map = useMap();

	const lineColorMap = useMemo(() => {
		if (activeLine === null) return null;
		const map: Record<string, string> = { [activeLine]: ACTIVE_COLOR };
		let pi = 0;
		for (const seg of segments) {
			if (!seg.groupLines.includes(activeLine)) continue;
			for (const l of seg.groupLines) {
				if (l !== activeLine && !(l in map)) {
					map[l] = HIGHLIGHT_PALETTE[pi % HIGHLIGHT_PALETTE.length];
					pi++;
				}
			}
		}
		return map;
	}, [segments, activeLine]);

	useEffect(() => {
		const clear = () => setSelectedLine(null);
		map.on("click", clear);
		return () => {
			map.off("click", clear);
		};
	}, [map]);

	const { normal, highlighted } = useMemo(() => {
		const n: number[] = [];
		const h: number[] = [];
		for (let i = 0; i < segments.length; i++) {
			const isHighlighted =
				activeLine !== null && segments[i].groupLines.includes(activeLine);
			(isHighlighted ? h : n).push(i);
		}
		return { normal: n, highlighted: h };
	}, [segments, activeLine]);

	if (showTrainRoute && selectedTrain) return null;

	const renderSegment = (i: number) => {
		const segment = segments[i];
		const isHighlighted =
			activeLine !== null && segment.groupLines.includes(activeLine);
		const highlightColor =
			isHighlighted && lineColorMap
				? (lineColorMap[segment.line] ?? ACTIVE_COLOR)
				: undefined;
		return (
			<Polyline
				key={i}
				positions={segment.points}
				pathOptions={{
					color: highlightColor ?? ROUTE_COLORS[segment.color],
					weight: isHighlighted ? 6 : 4,
					opacity: 0.85,
				}}
				eventHandlers={{
					mouseover: () => setHoveredLine(segment.line),
					mouseout: () => setHoveredLine(null),
					click: (e) => {
						e.originalEvent.stopPropagation();
						setSelectedLine((prev) =>
							prev === segment.line ? null : segment.line,
						);
					},
				}}
			>
				{segment.groupLines.length > 0 && (
					<Tooltip sticky>
						{getLineLabels(segment.groupLines).map(
							({ line, lkname, title }) => (
								<div key={line}>
									<span
										style={{
											color: lineColorMap?.[line] ?? "#ffffff",
											fontWeight: 600,
										}}
									>
										LK{line}
										{lkname ? ` - ${lkname}` : ""}
									</span>
									{title && (
										<div style={{ fontSize: "0.85em", opacity: 0.8 }}>
											{title}
										</div>
									)}
								</div>
							),
						)}
					</Tooltip>
				)}
			</Polyline>
		);
	};

	return (
		<>
			{normal.map(renderSegment)}
			{highlighted.map(renderSegment)}
		</>
	);
};

export default memo(PlayableArea);
