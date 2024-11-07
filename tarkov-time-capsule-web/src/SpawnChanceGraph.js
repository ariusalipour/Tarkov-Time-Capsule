import React, { useState, useEffect } from 'react';
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
import 'chartjs-adapter-date-fns'; // Import the date adapter

// Register the components you are using
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale // Register the time scale
);

const SpawnChanceGraph = () => {
    // Calculate default dates
    const now = new Date();
    const defaultEndDate = new Date(now);
    defaultEndDate.setDate(now.getDate() + 1); // Tomorrow
    const defaultStartDate = new Date(now);
    defaultStartDate.setDate(now.getDate() - 7); // One week prior

    // Format the dates as YYYY-MM-DD for input fields
    const formatDate = (date) => date.toISOString().split('T')[0];

    // State variables
    const [data, setData] = useState(null);
    const [mapName, setMapName] = useState('');
    const [bossName, setBossName] = useState('');
    const [startDate, setStartDate] = useState(formatDate(defaultStartDate)); // Default to one week prior
    const [endDate, setEndDate] = useState(formatDate(defaultEndDate)); // Default to tomorrow
    const [chartData, setChartData] = useState(null);

    // Fetch data only when the button is pressed or when the component is first mounted
    const fetchData = async () => {
        try {
            const baseUrl = process.env.REACT_APP_API_URL || 'https://tarkov-time-capsule-api.aryan-alipour.workers.dev/api/spawnchance';
            let url = `${baseUrl}?`;

            if (mapName) url += `mapName=${mapName}&`;
            if (bossName) url += `bossName=${bossName}&`;
            if (startDate) url += `startDate=${startDate}&`;
            if (endDate) url += `endDate=${endDate}&`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            const result = await response.json();
            setData(result);
            prepareChartData(result); // Update the chart data once the data is fetched
        } catch (error) {
            console.error("Error fetching data:", error);
        }
    };


    // Prepare the data for the chart
    const prepareChartData = (apiData) => {
        if (!apiData) {
            return;
        }

        // Determine how to group the data
        const shouldGroupByBoss = mapName !== '' || (mapName !== '' && bossName !== '');
        const shouldGroupByMap = bossName !== '' && mapName === '';
        const shouldGroupByBoth = mapName === '' && bossName === '';

        // Create a dataset based on the grouping preference
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

            groupedData[groupKey].data.push({
                x: new Date(item.Timestamp), // X-axis is the timestamp
                y: item.Chance, // Y-axis is the spawn chance
            });
        });

        setChartData({
            datasets: Object.values(groupedData),
        });
    };

    // Load data when the component mounts
    useEffect(() => {
        fetchData();
    }, []); // Empty dependency array means this effect runs once when the component mounts

    // Boss and Map options
    const bossOptions = [
        'Infected Tagilla',
        'Infected',
        'assault',
        'Knight',
        'Reshala',
        'Shturman',
        'Zryachiy',
        'Partisan',
        'Rogue',
        'Sanitar',
    ];

    const mapOptions = [
        'Factory',
        'Customs',
        'Woods',
        'Lighthouse',
        'Shoreline',
        'Reserve',
        'Interchange',
        'Streets of Tarkov',
        'Night Factory',
        'The Lab',
    ];

    return (
        <div>
            <h1>Tarkov Spawn Chance Data</h1>
            <div>
                <label>
                    Map Name:
                    <select value={mapName} onChange={(e) => setMapName(e.target.value)}>
                        <option value="">Select Map</option>
                        {mapOptions.map((map, index) => (
                            <option key={index} value={map}>
                                {map}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Boss Name:
                    <select value={bossName} onChange={(e) => setBossName(e.target.value)}>
                        <option value="">Select Boss</option>
                        {bossOptions.map((boss, index) => (
                            <option key={index} value={boss}>
                                {boss}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Start Date:
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
                <label>
                    End Date:
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </label>
                <button onClick={fetchData}>Fetch Data</button>
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
                                },
                                title: {
                                    display: true,
                                    text: 'Spawn Chances Over Time',
                                },
                            },
                            scales: {
                                x: {
                                    type: 'time', // Time scale for the x-axis
                                    time: {
                                        unit: 'minute', // Adjust the unit to display timestamps in detail
                                        tooltipFormat: 'yyyy-MM-dd HH:mm:ss', // Display full timestamp in tooltip
                                        displayFormats: {
                                            minute: 'HH:mm', // Display format for each tick
                                            hour: 'HH:mm', // Display format for hours
                                            day: 'MMM dd', // Display format for days
                                        },
                                    },
                                    title: {
                                        display: true,
                                        text: 'Timestamp',
                                    },
                                },
                                y: {
                                    title: {
                                        display: true,
                                        text: 'Spawn Chance (%)',
                                    },
                                    min: 0,
                                    max: 100,
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
