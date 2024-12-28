import React, { useState, useEffect, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale
);

const SpawnChanceGraph = () => {
    const now = new Date();
    const defaultEndDate = new Date(now);
    defaultEndDate.setDate(now.getDate() + 1);
    const defaultStartDate = new Date(now);
    defaultStartDate.setDate(now.getDate() - 7);

    const formatDate = (date) => date.toISOString().split('T')[0];

    const [mapName, setMapName] = useState('');
    const [bossName, setBossName] = useState('');
    const [startDate, setStartDate] = useState(formatDate(defaultStartDate));
    const [endDate, setEndDate] = useState(formatDate(defaultEndDate));
    const [chartData, setChartData] = useState(null);
    const [maxYAxisValue, setMaxYAxisValue] = useState(100);
    const [capPercentage, setCapPercentage] = useState(true);
    const [bossOptions, setBossOptions] = useState([]);
    const [mapOptions, setMapOptions] = useState([]);
    const yAxisOptions = [10000, 1000, 100, 80, 60, 40, 20];

    // Fetch Boss and Map Options
    useEffect(() => {
        const fetchBosses = async () => {
            try {
                const response = await fetch(`${process.env.REACT_APP_API_URL}api/bosses`);
                if (!response.ok) throw new Error('Failed to fetch bosses');
                const data = await response.json();
                setBossOptions(data); // Assumes data is an array of boss names
            } catch (error) {
                console.error('Error fetching bosses:', error);
            }
        };

        const fetchMaps = async () => {
            try {
                const response = await fetch(`${process.env.REACT_APP_API_URL}api/maps`);
                if (!response.ok) throw new Error('Failed to fetch maps');
                const data = await response.json();
                setMapOptions(data); // Assumes data is an array of map names
            } catch (error) {
                console.error('Error fetching maps:', error);
            }
        };

        fetchBosses();
        fetchMaps();
    }, []);

    const prepareChartData = useCallback(
        (apiData) => {
            if (!apiData) return;

            const shouldGroupByBoss = mapName !== '' || (mapName !== '' && bossName !== '');
            const shouldGroupByMap = bossName !== '' && mapName === '';
            const shouldGroupByBoth = mapName === '' && bossName === '';

            const groupedData = {};

            apiData.forEach((item) => {
                let groupKey = '';

                if (shouldGroupByBoss) {
                    groupKey = item.BossName;
                } else if (shouldGroupByMap) {
                    groupKey = item.MapName;
                } else if (shouldGroupByBoth) {
                    groupKey = `${item.MapName} - ${item.BossName}`;
                }

                if (!groupedData[groupKey]) {
                    groupedData[groupKey] = {
                        label: groupKey,
                        data: [],
                        backgroundColor: `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(
                            Math.random() * 255
                        )}, ${Math.floor(Math.random() * 255)}, 0.5)`,
                        borderColor: `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(
                            Math.random() * 255
                        )}, ${Math.floor(Math.random() * 255)}, 1)`,
                        fill: false,
                    };
                }

                let spawnChancePercentage = item.Chance * 100;
                if (capPercentage && spawnChancePercentage > 100) {
                    spawnChancePercentage = 100;
                }

                groupedData[groupKey].data.push({
                    x: new Date(item.Timestamp),
                    y: spawnChancePercentage,
                });
            });

            setChartData({
                datasets: Object.values(groupedData),
            });
        },
        [mapName, bossName, capPercentage]
    );

    const fetchData = useCallback(async () => {
        try {
            let url = `${process.env.REACT_APP_API_URL}api/spawnchance?`;
            if (mapName) url += `mapName=${mapName}&`;
            if (bossName) url += `bossName=${bossName}&`;
            if (startDate) url += `startDate=${startDate}&`;
            if (endDate) url += `endDate=${endDate}&`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`API request failed with status ${response.status}`);

            const result = await response.json();
            prepareChartData(result);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }, [mapName, bossName, startDate, endDate, prepareChartData]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return (
        <div style={{ backgroundColor: '#121212', color: '#FFFFFF', minHeight: '100vh', padding: '20px' }}>
            <h1>Tarkov Spawn Chance Data</h1>
            <div style={{ marginBottom: '20px' }}>
                <label style={{ marginRight: '15px' }}>
                    Map Name:
                    <select
                        value={mapName}
                        onChange={(e) => setMapName(e.target.value)}
                        style={{ backgroundColor: '#333333', color: '#FFFFFF', marginLeft: '5px' }}
                    >
                        <option value="">Select Map</option>
                        {mapOptions.map((map, index) => (
                            <option key={index} value={map}>
                                {map}
                            </option>
                        ))}
                    </select>
                </label>
                <label style={{ marginRight: '15px' }}>
                    Boss Name:
                    <select
                        value={bossName}
                        onChange={(e) => setBossName(e.target.value)}
                        style={{ backgroundColor: '#333333', color: '#FFFFFF', marginLeft: '5px' }}
                    >
                        <option value="">Select Boss</option>
                        {bossOptions.map((boss, index) => (
                            <option key={index} value={boss}>
                                {boss}
                            </option>
                        ))}
                    </select>
                </label>
                <label style={{ marginRight: '15px' }}>
                    Start Date:
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        style={{ backgroundColor: '#333333', color: '#FFFFFF', marginLeft: '5px' }}
                    />
                </label>
                <label style={{ marginRight: '15px' }}>
                    End Date:
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        style={{ backgroundColor: '#333333', color: '#FFFFFF', marginLeft: '5px' }}
                    />
                </label>
                <div style={{ marginBottom: '15px', marginTop: '15px' }}>
                    <label style={{ marginRight: '15px' }}>
                        Cap Spawn Chance at 100%:
                        <input
                            type="checkbox"
                            checked={capPercentage}
                            onChange={(e) => {
                                setCapPercentage(e.target.checked);
                                if (e.target.checked && maxYAxisValue > 100) {
                                    setMaxYAxisValue(100); // If capped, reset max value to 100 if it's over 100
                                }
                            }}
                            style={{ marginLeft: '10px' }}
                        />
                    </label>
                    <label style={{ marginRight: '15px' }}>
                        Y-Axis Max Value:
                        <select
                            value={maxYAxisValue}
                            onChange={(e) => setMaxYAxisValue(parseInt(e.target.value))}
                            style={{ backgroundColor: '#333333', color: '#FFFFFF', marginLeft: '5px' }}
                            disabled={capPercentage && maxYAxisValue > 100} // Disable selecting values > 100 if cap is checked
                        >
                            {yAxisOptions
                                .filter((value) => !capPercentage || value <= 100) // Filter out values greater than 100 if cap is checked
                                .map((value, index) => (
                                    <option key={index} value={value}>
                                        {value}
                                    </option>
                                ))}
                        </select>
                    </label>
                </div>
                <button
                    onClick={fetchData}
                    style={{
                        backgroundColor: '#444444',
                        color: '#FFFFFF',
                        border: 'none',
                        padding: '10px 20px',
                        cursor: 'pointer',
                    }}
                >
                    Fetch Data
                </button>
            </div>

            {chartData && (
                <div>
                    <Line
                        data={chartData}
                        options={{
                            responsive: true,
                            plugins: {
                                legend: {
                                    position: 'top',
                                    labels: {
                                        color: '#FFFFFF', // Legend text color
                                    },
                                },
                                title: {
                                    display: true,
                                    text: 'Spawn Chances Over Time',
                                    color: '#FFFFFF', // Title text color
                                },
                                tooltip: {
                                    titleColor: '#FFFFFF',
                                    bodyColor: '#FFFFFF',
                                    backgroundColor: '#333333',
                                },
                            },
                            scales: {
                                x: {
                                    type: 'time', // Time scale for the x-axis
                                    time: {
                                        unit: dateRange > 3 ? 'day' : 'hour', // Adjust the unit to display timestamps in detail
                                        tooltipFormat: 'yyyy-MM-dd HH:mm:ss', // Display full timestamp in tooltip
                                        displayFormats: {
                                            hour: 'HH:mm', // Display format for hours
                                            day: 'MMM dd', // Display format for days
                                        },
                                    },
                                    title: {
                                        display: true,
                                        text: 'Timestamp',
                                        color: '#FFFFFF', // X-axis title color
                                    },
                                    ticks: {
                                        color: '#FFFFFF', // X-axis labels color
                                    },
                                },
                                y: {
                                    title: {
                                        display: true,
                                        text: 'Spawn Chance (%)',
                                        color: '#FFFFFF', // Y-axis title color
                                    },
                                    min: 0,
                                    max: capPercentage && maxYAxisValue > 100 ? 100 : maxYAxisValue, // Set max to 100 if cap is checked, otherwise use maxYAxisValue
                                    ticks: {
                                        color: '#FFFFFF', // Y-axis labels color
                                    },
                                },
                            },
                        }}
                    />
                </div>
            )}
        </div>
    );
};

export default SpawnChanceGraph;
