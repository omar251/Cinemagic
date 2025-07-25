#!/usr/bin/env node
/**
 * Movie Network Generator
 * Creates a network graph of movies based on their relationships
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class MovieNetworkGenerator {
    constructor(baseUrl = 'http://127.0.0.1:5000/api') {
        this.baseUrl = baseUrl;
        this.movieNetwork = new Map();
        this.visitedMovies = new Set();
        this.maxDepth = 3;
        this.maxMoviesPerLevel = 5;
    }

    async searchMovie(query) {
        try {
            const response = await axios.get(`${this.baseUrl}/search/movies/fast?query=${encodeURIComponent(query)}`);
            return response.data[0]?.movie || null;
        } catch (error) {
            console.error(`Error searching for movie "${query}":`, error.message);
            return null;
        }
    }

    async getRelatedMovies(movieId) {
        try {
            const response = await axios.get(`${this.baseUrl}/movies/${movieId}/related/fast`);
            return response.data.slice(0, this.maxMoviesPerLevel);
        } catch (error) {
            console.error(`Error getting related movies for ${movieId}:`, error.message);
            return [];
        }
    }

    async buildNetwork(startMovieQuery, depth = 0) {
        if (depth >= this.maxDepth) return;

        const displayName = typeof startMovieQuery === 'string' ? startMovieQuery : `${startMovieQuery.title} (${startMovieQuery.year})`;
        console.log(`${'  '.repeat(depth)}🔍 ${depth === 0 ? 'Starting with' : 'Exploring'}: ${displayName}`);

        let startMovie;
        if (typeof startMovieQuery === 'string') {
            startMovie = await this.searchMovie(startMovieQuery);
            if (!startMovie) {
                console.log(`❌ Movie "${startMovieQuery}" not found`);
                return;
            }
        } else {
            startMovie = startMovieQuery;
        }

        const movieId = startMovie.ids.trakt;
        const movieKey = `${startMovie.title} (${startMovie.year})`;

        if (this.visitedMovies.has(movieId)) {
            return;
        }

        this.visitedMovies.add(movieId);
        
        if (!this.movieNetwork.has(movieKey)) {
            this.movieNetwork.set(movieKey, {
                id: movieId,
                title: startMovie.title,
                year: startMovie.year,
                slug: startMovie.slug,
                connections: [],
                depth: depth
            });
        }

        console.log(`${'  '.repeat(depth)}📊 Getting related movies...`);
        const relatedMovies = await this.getRelatedMovies(movieId);
        
        for (const related of relatedMovies) {
            const relatedKey = `${related.title} (${related.year})`;
            
            // Add connection
            this.movieNetwork.get(movieKey).connections.push({
                title: related.title,
                year: related.year,
                id: related.ids.trakt,
                key: relatedKey
            });

            // Recursively explore related movies
            if (depth < this.maxDepth - 1) {
                await this.buildNetwork(related, depth + 1);
            }
        }

        // Add a small delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    generateD3Visualization() {
        const nodes = [];
        const links = [];
        const nodeMap = new Map();

        // Create nodes
        let nodeId = 0;
        for (const [movieKey, movieData] of this.movieNetwork) {
            const node = {
                id: nodeId,
                name: movieKey,
                title: movieData.title,
                year: movieData.year,
                depth: movieData.depth,
                group: movieData.depth + 1,
                traktId: movieData.id
            };
            nodes.push(node);
            nodeMap.set(movieKey, nodeId);
            nodeId++;
        }

        // Create links
        for (const [movieKey, movieData] of this.movieNetwork) {
            const sourceId = nodeMap.get(movieKey);
            
            for (const connection of movieData.connections) {
                const targetId = nodeMap.get(connection.key);
                if (targetId !== undefined) {
                    links.push({
                        source: sourceId,
                        target: targetId,
                        value: 1
                    });
                }
            }
        }

        return { nodes, links };
    }

    generateHTML(graphData) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Movie Network Graph</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #1a1a2e, #16213e);
            color: white;
            min-height: 100vh;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 20px;
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            background: linear-gradient(45deg, #e94560, #f6e05e);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .controls {
            text-align: center;
            margin-bottom: 20px;
        }

        .btn {
            background: linear-gradient(45deg, #e94560, #f6e05e);
            border: none;
            color: white;
            padding: 10px 20px;
            border-radius: 10px;
            cursor: pointer;
            margin: 0 10px;
            font-weight: bold;
            transition: transform 0.2s;
        }

        .btn:hover {
            transform: scale(1.05);
        }

        #graph {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .node {
            cursor: pointer;
            stroke: #fff;
            stroke-width: 2px;
        }

        .link {
            stroke: rgba(255, 255, 255, 0.3);
            stroke-width: 1px;
        }

        .node-label {
            font-size: 12px;
            fill: white;
            text-anchor: middle;
            pointer-events: none;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        }

        .tooltip {
            position: absolute;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 10px;
            border-radius: 8px;
            pointer-events: none;
            font-size: 14px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            max-width: 200px;
        }

        .legend {
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            padding: 15px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .legend-item {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
        }

        .legend-color {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            margin-right: 8px;
        }

        .stats {
            text-align: center;
            margin-top: 20px;
            background: rgba(255, 255, 255, 0.1);
            padding: 15px;
            border-radius: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎬 Movie Network Graph</h1>
            <p>Interactive visualization of movie relationships</p>
        </div>

        <div class="controls">
            <button class="btn" onclick="restartSimulation()">🔄 Restart</button>
            <button class="btn" onclick="centerGraph()">🎯 Center</button>
            <button class="btn" onclick="toggleLabels()">🏷️ Toggle Labels</button>
        </div>

        <div style="position: relative;">
            <svg id="graph"></svg>
            <div class="legend">
                <h4 style="margin-top: 0;">Depth Levels</h4>
                <div class="legend-item">
                    <div class="legend-color" style="background: #e94560;"></div>
                    <span>Starting Movie</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #f6e05e;"></div>
                    <span>1st Degree</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #10b981;"></div>
                    <span>2nd Degree</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #3b82f6;"></div>
                    <span>3rd Degree</span>
                </div>
            </div>
        </div>

        <div class="stats">
            <strong>Network Stats:</strong> 
            <span id="node-count">${graphData.nodes.length}</span> movies, 
            <span id="link-count">${graphData.links.length}</span> connections
        </div>
    </div>

    <div class="tooltip" id="tooltip" style="display: none;"></div>

    <script>
        const graphData = ${JSON.stringify(graphData, null, 2)};
        
        const width = 1200;
        const height = 800;
        let showLabels = true;

        const colorScale = d3.scaleOrdinal()
            .domain([1, 2, 3, 4])
            .range(['#e94560', '#f6e05e', '#10b981', '#3b82f6']);

        const svg = d3.select('#graph')
            .attr('width', width)
            .attr('height', height);

        const g = svg.append('g');

        // Add zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
            });

        svg.call(zoom);

        // Create simulation
        const simulation = d3.forceSimulation(graphData.nodes)
            .force('link', d3.forceLink(graphData.links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(30));

        // Create links
        const link = g.append('g')
            .selectAll('line')
            .data(graphData.links)
            .enter().append('line')
            .attr('class', 'link');

        // Create nodes
        const node = g.append('g')
            .selectAll('circle')
            .data(graphData.nodes)
            .enter().append('circle')
            .attr('class', 'node')
            .attr('r', d => d.depth === 0 ? 12 : 8)
            .attr('fill', d => colorScale(d.group))
            .call(d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended))
            .on('mouseover', showTooltip)
            .on('mouseout', hideTooltip)
            .on('click', nodeClicked);

        // Create labels
        const labels = g.append('g')
            .selectAll('text')
            .data(graphData.nodes)
            .enter().append('text')
            .attr('class', 'node-label')
            .text(d => d.title)
            .style('font-size', d => d.depth === 0 ? '14px' : '12px')
            .style('font-weight', d => d.depth === 0 ? 'bold' : 'normal');

        // Simulation tick
        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node
                .attr('cx', d => d.x)
                .attr('cy', d => d.y);

            labels
                .attr('x', d => d.x)
                .attr('y', d => d.y + 25);
        });

        // Drag functions
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }

        // Tooltip functions
        function showTooltip(event, d) {
            const tooltip = d3.select('#tooltip');
            tooltip.style('display', 'block')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px')
                .html(\`
                    <strong>\${d.title} (\${d.year})</strong><br>
                    Depth: \${d.depth}<br>
                    Trakt ID: \${d.traktId}<br>
                    Connections: \${graphData.links.filter(l => l.source.id === d.id || l.target.id === d.id).length}
                \`);
        }

        function hideTooltip() {
            d3.select('#tooltip').style('display', 'none');
        }

        function nodeClicked(event, d) {
            console.log('Clicked movie:', d);
            // You could add functionality to open movie details here
        }

        // Control functions
        function restartSimulation() {
            simulation.alpha(1).restart();
        }

        function centerGraph() {
            const transform = d3.zoomIdentity.translate(width / 2, height / 2).scale(1);
            svg.transition().duration(750).call(zoom.transform, transform);
        }

        function toggleLabels() {
            showLabels = !showLabels;
            labels.style('display', showLabels ? 'block' : 'none');
        }

        // Initial center
        setTimeout(centerGraph, 1000);
    </script>
</body>
</html>`;
    }

    async generateNetworkGraph(startMovieQuery, outputFile = 'movie_network.html') {
        console.log('🎬 Movie Network Generator');
        console.log('='.repeat(50));
        console.log(`🎯 Starting movie: ${startMovieQuery}`);
        console.log(`📊 Max depth: ${this.maxDepth}`);
        console.log(`🔢 Max movies per level: ${this.maxMoviesPerLevel}`);
        console.log('');

        try {
            // Build the network
            await this.buildNetwork(startMovieQuery);

            console.log('');
            console.log('📈 Network Statistics:');
            console.log(`   Total movies: ${this.movieNetwork.size}`);
            console.log(`   Total connections: ${Array.from(this.movieNetwork.values()).reduce((sum, movie) => sum + movie.connections.length, 0)}`);

            // Generate visualization data
            const graphData = this.generateD3Visualization();
            
            // Generate HTML
            const html = this.generateHTML(graphData);
            
            // Write to file
            fs.writeFileSync(outputFile, html);
            
            console.log('');
            console.log('✅ Network graph generated successfully!');
            console.log(`📄 Output file: ${outputFile}`);
            console.log(`🌐 Open in browser: file://${path.resolve(outputFile)}`);
            
            return {
                networkSize: this.movieNetwork.size,
                totalConnections: graphData.links.length,
                outputFile: outputFile
            };

        } catch (error) {
            console.error('❌ Error generating network:', error.message);
            throw error;
        }
    }
}

// CLI usage
async function main() {
    const args = process.argv.slice(2);
    const movieQuery = args[0] || 'The Dark Knight';
    const outputFile = args[1] || 'movie_network.html';

    const generator = new MovieNetworkGenerator();
    
    try {
        await generator.generateNetworkGraph(movieQuery, outputFile);
    } catch (error) {
        console.error('Failed to generate network:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = MovieNetworkGenerator;