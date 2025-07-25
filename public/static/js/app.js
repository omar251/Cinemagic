import { DynamicMovieNetwork } from './lib/network.js';
import { getCachedMovies, searchCachedMovies, getCacheStats, getCachedMovie, clearCache } from './lib/api.js';
import { databaseSearch } from './lib/database-search.js';
import { TTSManager } from './lib/tts.js';
import * as api from './lib/api.js';
import * as ui from './lib/ui.js';

document.addEventListener('DOMContentLoaded', () => {
    if (typeof d3 === 'undefined') {
        console.error('D3.js failed to load from CDN');
        document.body.innerHTML += '<div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: red; color: white; padding: 20px; border-radius: 10px; z-index: 9999;">❌ D3.js failed to load. Check internet connection.</div>';
        return;
    }

    const network = new DynamicMovieNetwork();
    const tts = new TTSManager();
    
    // Enhanced search functionality with database-first approach
    let searchTimeout;
    let recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
    
    // Initialize database cache stats on load
    async function initializeDatabaseStats() {
        try {
            const stats = await getCacheStats();
            console.log('📊 Database cache initialized:', {
                totalMovies: stats.movieData?.database?.totalMovies || 0,
                averageRating: stats.movieData?.database?.averageRating || 0,
                type: stats.type || 'unknown'
            });
        } catch (error) {
            console.error('Failed to initialize database stats:', error);
        }
    }
    
    // Call initialization
    initializeDatabaseStats();
    let isSearchDropdownOpen = false;
    
    // Add database cache management panel
    function createCacheManagementPanel() {
        const panel = document.createElement('div');
        panel.id = 'cachePanel';
        panel.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            width: 300px;
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            border: 1px solid var(--glass-border);
            border-radius: 15px;
            padding: 15px;
            color: var(--text-color);
            font-size: 12px;
            z-index: 999;
            display: none;
        `;
        
        panel.innerHTML = `
            <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0; color: var(--accent-color);">🗄️ Database Cache</h4>
                <button id="closeCachePanel" style="background: none; border: none; color: var(--text-color); cursor: pointer; font-size: 16px;">&times;</button>
            </div>
            <div id="cacheStats" style="margin-bottom: 15px;"></div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button class="control-btn" id="refreshCacheStats" style="font-size: 10px; padding: 5px 10px;">Refresh</button>
                <button class="control-btn" id="clearMemoryCache" style="font-size: 10px; padding: 5px 10px;">Clear Memory</button>
                <button class="control-btn" id="searchCacheBtn" style="font-size: 10px; padding: 5px 10px;">Search Cache</button>
            </div>
            <div id="searchCacheInput" style="display: none; margin-top: 10px;">
                <input type="text" placeholder="Search cached movies..." style="width: 100%; padding: 5px; border-radius: 5px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.1); color: var(--text-color);">
                <div id="cacheSearchResults" style="max-height: 200px; overflow-y: auto; margin-top: 5px;"></div>
            </div>
        `;
        
        document.body.appendChild(panel);
        
        // Add event listeners
        document.getElementById('closeCachePanel').addEventListener('click', () => {
            panel.style.display = 'none';
        });
        
        document.getElementById('refreshCacheStats').addEventListener('click', updateCachePanel);
        
        document.getElementById('clearMemoryCache').addEventListener('click', async () => {
            try {
                await clearCache('memory');
                ui.showNotification('Memory cache cleared', 'success');
                updateCachePanel();
            } catch (error) {
                ui.showNotification('Failed to clear cache', 'error');
            }
        });
        
        document.getElementById('searchCacheBtn').addEventListener('click', () => {
            const searchDiv = document.getElementById('searchCacheInput');
            searchDiv.style.display = searchDiv.style.display === 'none' ? 'block' : 'none';
        });
        
        // Cache search functionality
        const searchInput = panel.querySelector('input');
        searchInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            if (query.length < 2) {
                document.getElementById('cacheSearchResults').innerHTML = '';
                return;
            }
            
            const results = await databaseSearch.searchMovies(query, { limit: 5 });
            const resultsDiv = document.getElementById('cacheSearchResults');
            
            if (results.length > 0) {
                resultsDiv.innerHTML = results.map(movie => `
                    <div style="padding: 5px; border-bottom: 1px solid var(--glass-border); cursor: pointer; font-size: 11px;" 
                         data-trakt-id="${movie.traktId || movie.trakt_id || movie.id}" class="cache-search-result">
                        <strong>${movie.title}</strong> (${movie.year})
                        ${movie.overall_rating ? `<span style="color: var(--gemini-accent);">⭐ ${movie.overall_rating}</span>` : ''}
                        <div style="font-size: 9px; color: var(--text-secondary);">ID: ${movie.traktId || movie.trakt_id || movie.id}</div>
                    </div>
                `).join('');
                
                // Add click handlers to add movies to network
                resultsDiv.querySelectorAll('.cache-search-result').forEach(item => {
                    item.addEventListener('click', async () => {
                        const traktId = item.dataset.traktId;
                        console.log(`🎬 Clicked movie with Trakt ID: ${traktId}`);
                        
                        if (!traktId || traktId === 'undefined' || traktId === 'null') {
                            console.error('❌ Invalid Trakt ID:', traktId);
                            ui.showNotification('Invalid movie ID', 'error');
                            return;
                        }
                        
                        const movie = await databaseSearch.getMovieById(traktId);
                        if (movie) {
                            await network.addMovieToNetwork(movie);
                            ui.showNotification(`Added ${movie.title} to network`, 'success');
                        } else {
                            ui.showNotification('Movie not found in cache', 'error');
                        }
                    });
                });
            } else {
                resultsDiv.innerHTML = '<div style="padding: 5px; color: var(--text-secondary);">No results found</div>';
            }
        });
        
        return panel;
    }
    
    // Update cache panel with current stats
    async function updateCachePanel() {
        const statsDiv = document.getElementById('cacheStats');
        if (!statsDiv) return;
        
        try {
            const stats = await getCacheStats();
            const dbStats = stats.movieData?.database || {};
            const memStats = stats.memory || {};
            
            statsDiv.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 10px;">
                    <div><strong>Total Movies:</strong> ${dbStats.totalMovies || 0}</div>
                    <div><strong>Avg Rating:</strong> ${dbStats.averageRating ? dbStats.averageRating.toFixed(1) : 'N/A'}</div>
                    <div><strong>Memory Cache:</strong> ${memStats.size || 0}/${memStats.maxSize || 100}</div>
                    <div><strong>Hit Rate:</strong> ${memStats.hitRate || 0}%</div>
                    <div><strong>Genres:</strong> ${dbStats.totalGenres || 0}</div>
                    <div><strong>Languages:</strong> ${dbStats.languagesCount || 0}</div>
                </div>
            `;
        } catch (error) {
            statsDiv.innerHTML = '<div style="color: var(--accent-color);">Error loading stats</div>';
        }
    }
    
    // Create cache panel
    const cachePanel = createCacheManagementPanel();

    function setupGlobalEventListeners() {
        // Cache panel toggle
        document.getElementById('cacheBtn')?.addEventListener('click', () => {
            const panel = document.getElementById('cachePanel');
            if (panel.style.display === 'none') {
                panel.style.display = 'block';
                updateCachePanel();
            } else {
                panel.style.display = 'none';
            }
        });
        // Enhanced search with debouncing and autocomplete
        const searchInput = document.getElementById('movieSearch');
        const searchBtn = document.getElementById('searchBtn');
        
        // Create search dropdown for autocomplete
        createSearchDropdown();
        
        searchBtn.addEventListener('click', () => network.searchAndAddMovie());
        
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            
            if (query.length >= 2) {
                searchTimeout = setTimeout(() => {
                    showSearchSuggestions(query);
                }, 300); // 300ms debounce
            } else {
                hideSearchDropdown();
            }
        });
        
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                hideSearchDropdown();
                network.searchAndAddMovie();
            }
        });
        
        searchInput.addEventListener('focus', () => {
            if (searchInput.value.trim().length >= 2) {
                showSearchSuggestions(searchInput.value.trim());
            } else {
                showRecentSearches();
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                hideSearchDropdown();
            }
        });

        document.getElementById('saveBtn').addEventListener('click', showSaveDialog);
        document.getElementById('loadBtn').addEventListener('click', showLoadDialog);
        document.getElementById('clearBtn').addEventListener('click', () => network.clearNetwork());
        document.getElementById('centerBtn').addEventListener('click', () => network.centerNetwork());
        document.getElementById('labelsBtn').addEventListener('click', () => network.toggleLabels());

        // Listen for custom event to remove a node
        document.addEventListener('removeNode', (e) => {
            const nodeId = e.detail.nodeId;
            network.removeNode(nodeId);
            ui.showNotification('Movie removed from network', 'info');
        });
        
        // Color mode icon buttons
        document.querySelectorAll('.color-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = btn.dataset.mode;
                
                // Update active state
                document.querySelectorAll('.color-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Set color mode and update legend (preserves existing filters)
                network.setColorMode(mode);
                
                // Apply all category filters to maintain persistent filtering and update counts
                if (network.applyAllCategoryFilters) {
                    // Small delay to ensure the color mode is set first
                    setTimeout(() => {
                        network.applyAllCategoryFilters();
                    }, 50);
                }
                
                // Show/hide load details button based on data availability
                const dataAvailability = network.checkDataAvailability(mode);
                const loadDetailsBtn = document.getElementById('loadDetailsBtn');
                
                if (dataAvailability.missing > 0) {
                    loadDetailsBtn.style.display = 'inline-block';
                    loadDetailsBtn.textContent = `📄 Load ${dataAvailability.missing}`;
                    btn.classList.add('needs-data');
                } else {
                    loadDetailsBtn.style.display = 'none';
                    btn.classList.remove('needs-data');
                }
                
                // Update visual indicators for categories with active filters
                network.updateCategoryFilterIndicators();
            });
        });

        // Load details button
        document.getElementById('loadDetailsBtn').addEventListener('click', () => {
            network.loadMissingDetailsForColorMode();
        });

        // Sidebar toggle button
        document.getElementById('toggleColorSidebar').addEventListener('click', () => {
            const sidebar = document.getElementById('colorModeSidebar');
            const toggleBtn = document.getElementById('toggleColorSidebar');
            
            sidebar.classList.toggle('minimized');
            toggleBtn.textContent = sidebar.classList.contains('minimized') ? '+' : '−';
        });

        // Clear all filters button
        document.getElementById('clearAllFiltersBtn').addEventListener('click', () => {
            if (network && network.clearAllFiltersGlobal) {
                network.clearAllFiltersGlobal();
            }
        });

        // Add AI insights button if it exists
        const aiBtn = document.getElementById('aiBtn');
        if (aiBtn) {
            aiBtn.addEventListener('click', () => generateNetworkInsights());
        }

        document.getElementById('closeSaveBtn').addEventListener('click', closeSaveDialog);
        document.getElementById('cancelSaveBtn').addEventListener('click', closeSaveDialog);
        document.getElementById('confirmSaveBtn').addEventListener('click', saveNetwork);
        document.getElementById('closeLoadBtn').addEventListener('click', closeLoadDialog);
        document.getElementById('cancelLoadBtn').addEventListener('click', closeLoadDialog);
        document.getElementById('refreshNetworksBtn').addEventListener('click', refreshNetworksList);

        window.addEventListener('click', (event) => {
            if (event.target === document.getElementById('saveModal')) closeSaveDialog();
            if (event.target === document.getElementById('loadModal')) closeLoadDialog();
        });

        document.addEventListener('click', (e) => {
            // Handle expand/collapse button
            if (e.target.closest('.expand-btn')) {
                e.stopPropagation();
                const expandBtn = e.target.closest('.expand-btn');
                const networkId = expandBtn.dataset.networkId;
                toggleNetworkExpansion(networkId);
                return;
            }

            // Handle delete button
            if (e.target.closest('.delete-btn')) {
                e.stopPropagation();
                const deleteBtn = e.target.closest('.delete-btn');
                const networkId = deleteBtn.dataset.networkId;
                deleteNetwork(networkId);
                return;
            }

            // Handle network item selection (only if not clicking on buttons)
            if (e.target.closest('.saved-network-item') && 
                !e.target.closest('.action-btn') && 
                !e.target.closest('.expand-btn') && 
                !e.target.closest('.delete-btn')) {
                const networkItem = e.target.closest('.saved-network-item');
                const networkId = networkItem.dataset.networkId;
                if (networkId) {
                    selectNetwork(networkId);
                }
            }

            // Handle action buttons
            if (e.target.closest('.action-btn')) {
                e.stopPropagation();
                const actionBtn = e.target.closest('.action-btn');
                const action = actionBtn.dataset.action;
                const networkId = actionBtn.dataset.networkId;
                
                if (action === 'load' && networkId) {
                    loadSelectedNetwork(networkId);
                } else if (action === 'export' && networkId) {
                    const format = actionBtn.dataset.format || 'json';
                    exportNetwork(networkId, format);
                } else if (action === 'preview' && networkId) {
                    previewNetwork(networkId);
                }
            }
        });
    }

    function showSaveDialog() {
        if (network.nodes.length === 0) {
            ui.showNotification('No network to save', 'error');
            return;
        }

        const modal = document.getElementById('saveModal');
        const preview = document.getElementById('savePreview');
        
        const totalMovies = network.nodes.length;
        const totalConnections = network.links.length;
        const seedMovie = network.nodes.find(n => n.depth === 0)?.title || 'Unknown';
        const genres = [...new Set(network.nodes.flatMap(n => {
            const details = n.fullDetails || n.basicDetails || {};
            return details.genres || [];
        }))];
        
        preview.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 13px;">
                <div><strong>Movies:</strong> ${totalMovies}</div>
                <div><strong>Connections:</strong> ${totalConnections}</div>
                <div><strong>Seed Movie:</strong> ${seedMovie}</div>
                <div><strong>Max Depth:</strong> ${Math.max(...network.nodes.map(n => n.depth))}</div>
            </div>
            ${genres.length > 0 ? `<div style="margin-top: 10px;"><strong>Genres:</strong> ${genres.slice(0, 5).join(', ')}${genres.length > 5 ? '...' : ''}</div>` : ''}
        `;
        
        const nameInput = document.getElementById('networkName');
        nameInput.value = seedMovie ? `${seedMovie} Network` : 'Movie Network';
        
        modal.style.display = 'flex';
        nameInput.focus();
    }

    function closeSaveDialog() {
        document.getElementById('saveModal').style.display = 'none';
    }

    async function saveNetwork() {
        const name = document.getElementById('networkName').value.trim();
        const description = document.getElementById('networkDescription').value.trim();
        
        if (!name) {
            ui.showNotification('Please enter a network name', 'error');
            return;
        }

        ui.showLoading(true);
        
        try {
            const networkData = {
                name: name,
                description: description,
                nodes: network.nodes,
                links: network.links.map(link => ({
                    source: typeof link.source === 'object' ? link.source.id : link.source,
                    target: typeof link.target === 'object' ? link.target.id : link.target
                })),
                settings: {
                    showLabels: network.showLabels,
                    colorScheme: 'default'
                },
                seedMovie: network.nodes.find(n => n.depth === 0)?.title || null
            };

            const result = await api.saveNetworkToServer(networkData);
            
            if (result.success) {
                ui.showNotification(`Network "${name}" saved successfully!`, 'success');
                closeSaveDialog();
                
                document.getElementById('networkName').value = '';
                document.getElementById('networkDescription').value = '';
            } else {
                ui.showNotification('Failed to save network', 'error');
            }
            
        } catch (error) {
            ui.showNotification('Failed to save network', 'error');
        } finally {
            ui.showLoading(false);
        }
    }

    async function showLoadDialog() {
        const modal = document.getElementById('loadModal');
        modal.style.display = 'flex';
        
        await refreshNetworksList();
    }

    function closeLoadDialog() {
        document.getElementById('loadModal').style.display = 'none';
    }

    async function refreshNetworksList() {
        const listContainer = document.getElementById('savedNetworksList');
        listContainer.innerHTML = '<div style="text-align: center; padding: 20px;">Loading saved networks...</div>';
        
        try {
            const networks = await api.getSavedNetworks();
            
            if (networks.length === 0) {
                listContainer.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                        <div style="font-size: 48px; margin-bottom: 15px;">📂</div>
                        <div>No saved networks found</div>
                        <div style="font-size: 12px; margin-top: 8px;">Create and save a network to see it here</div>
                    </div>
                `;
                return;
            }
            
            listContainer.innerHTML = networks.map(net => {
                const createdDate = new Date(net.createdAt).toLocaleDateString();
                const createdTime = new Date(net.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                
                return `
                    <div class="saved-network-item" data-network-id="${net.id}">
                        <div class="network-item-header">
                            <div class="network-item-title-row">
                                <button class="expand-btn" data-network-id="${net.id}" title="Expand/Collapse Details">
                                    <span class="expand-icon">▶</span>
                                </button>
                                <div class="network-item-title">${net.name}</div>
                                <button class="delete-btn" data-action="delete" data-network-id="${net.id}" title="Delete Network">
                                    🗑️
                                </button>
                            </div>
                            <div class="network-item-date">${createdDate} ${createdTime}</div>
                        </div>
                        <div class="network-item-content" style="display: none;">
                            ${net.description ? `<div class="network-item-description">${net.description}</div>` : ''}
                            <div class="network-item-stats">
                                <span>🎬 ${net.metadata.totalMovies} movies</span>
                                <span>🔗 ${net.metadata.totalConnections} connections</span>
                                <span>⭐ ${net.metadata.averageRating || 'N/A'}</span>
                                <span>📊 Depth ${net.metadata.maxDepth}</span>
                                ${net.metadata.genres ? `<span>🎭 ${net.metadata.genres.length} genres</span>` : ''}
                            </div>
                            <div class="network-item-actions">
                                <button class="action-btn" data-action="load" data-network-id="${net.id}">📂 Load</button>
                                <button class="action-btn" data-action="export" data-network-id="${net.id}" data-format="json">📤 Export</button>
                                <button class="action-btn" data-action="preview" data-network-id="${net.id}">👁️ Preview</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            
        } catch (error) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--accent-color);">
                    Failed to load saved networks
                </div>
            `;
        }
    }

    let selectedNetworkId = null;

    function selectNetwork(networkId) {
        document.querySelectorAll('.saved-network-item').forEach(item => {
            item.classList.remove('selected');
        });
        
        event.currentTarget.classList.add('selected');
        selectedNetworkId = networkId;
    }

    async function loadSelectedNetwork(networkId) {
        ui.showLoading(true);
        
        try {
            const networkData = await api.loadNetworkFromServer(networkId);
            network.loadNetworkData(networkData);
            
            ui.showNotification(`Network "${networkData.name}" loaded successfully!`, 'success');
            closeLoadDialog();
            
        } catch (error) {
            ui.showNotification('Failed to load network', 'error');
        } finally {
            ui.showLoading(false);
        }
    }

    async function deleteNetwork(networkId) {
        if (!confirm('Are you sure you want to delete this network? This action cannot be undone.')) {
            return;
        }
        
        try {
            await api.deleteNetworkFromServer(networkId);
            ui.showNotification('Network deleted successfully', 'success');
            refreshNetworksList();
            
        } catch (error) {
            ui.showNotification('Failed to delete network', 'error');
        }
    }

    async function exportNetwork(networkId, format) {
        const success = await api.exportNetwork(networkId, format);
        if (success) {
            ui.showNotification(`Network exported as ${format.toUpperCase()}`, 'success');
        } else {
            ui.showNotification('Failed to export network', 'error');
        }
    }

    function toggleNetworkExpansion(networkId) {
        const networkItem = document.querySelector(`[data-network-id="${networkId}"]`);
        if (!networkItem) return;

        const content = networkItem.querySelector('.network-item-content');
        const expandIcon = networkItem.querySelector('.expand-icon');
        
        if (content.style.display === 'none') {
            // Expand
            content.style.display = 'block';
            expandIcon.textContent = '▼';
            networkItem.classList.add('expanded');
        } else {
            // Collapse
            content.style.display = 'none';
            expandIcon.textContent = '▶';
            networkItem.classList.remove('expanded');
        }
    }

    async function previewNetwork(networkId) {
        try {
            const networkData = await api.loadNetworkFromServer(networkId);
            showNetworkPreview(networkData);
        } catch (error) {
            ui.showNotification('Failed to load network preview', 'error');
        }
    }

    function showNetworkPreview(networkData) {
        // Create preview modal if it doesn't exist
        let modal = document.getElementById('networkPreviewModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'networkPreviewModal';
            modal.className = 'modal';
            modal.style.display = 'none';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h3>📊 Network Preview</h3>
                        <button class="close-btn" id="closePreviewBtn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="previewContent"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="control-btn" id="loadFromPreviewBtn">📂 Load Network</button>
                        <button class="control-btn" id="closePreviewFooterBtn">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Generate preview content
        const topMovies = networkData.nodes
            .filter(node => node.fullDetails?.rating)
            .sort((a, b) => (b.fullDetails.rating || 0) - (a.fullDetails.rating || 0))
            .slice(0, 5);

        const genres = [...new Set(networkData.nodes.flatMap(node => 
            node.fullDetails?.genres || node.basicDetails?.genres || []
        ))];

        document.getElementById('previewContent').innerHTML = `
            <div style="margin-bottom: 20px;">
                <h4 style="color: var(--gemini-accent); margin-bottom: 10px;">${networkData.name}</h4>
                ${networkData.description ? `<p style="color: var(--text-secondary); margin-bottom: 15px;">${networkData.description}</p>` : ''}
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div><strong>🎬 Movies:</strong> ${networkData.metadata?.totalMovies || networkData.nodes.length}</div>
                    <div><strong>🔗 Connections:</strong> ${networkData.metadata?.totalConnections || networkData.links?.length || 0}</div>
                    <div><strong>📊 Max Depth:</strong> ${networkData.metadata?.maxDepth || Math.max(...networkData.nodes.map(n => n.depth || 0))}</div>
                    <div><strong>⭐ Avg Rating:</strong> ${networkData.metadata?.averageRating || 'N/A'}</div>
                </div>

                ${topMovies.length > 0 ? `
                    <div style="margin-bottom: 20px;">
                        <h5 style="color: var(--accent-color); margin-bottom: 10px;">🏆 Top Rated Movies</h5>
                        <div style="max-height: 150px; overflow-y: auto;">
                            ${topMovies.map(movie => `
                                <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid var(--glass-border);">
                                    <span>${movie.title} (${movie.year})</span>
                                    <span style="color: var(--gemini-accent);">⭐ ${movie.fullDetails.rating.toFixed(1)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${genres.length > 0 ? `
                    <div>
                        <h5 style="color: var(--accent-color); margin-bottom: 10px;">🎭 Genres (${genres.length})</h5>
                        <div style="display: flex; flex-wrap: wrap; gap: 5px;">
                            ${genres.slice(0, 10).map(genre => 
                                `<span style="background: var(--glass-bg); padding: 3px 8px; border-radius: 10px; font-size: 12px;">${genre}</span>`
                            ).join('')}
                            ${genres.length > 10 ? `<span style="color: var(--text-secondary); font-size: 12px;">+${genres.length - 10} more</span>` : ''}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
        
        modal.style.display = 'flex';
        
        // Add event listeners
        document.getElementById('closePreviewBtn').onclick = () => modal.style.display = 'none';
        document.getElementById('closePreviewFooterBtn').onclick = () => modal.style.display = 'none';
        document.getElementById('loadFromPreviewBtn').onclick = () => {
            modal.style.display = 'none';
            network.loadNetworkData(networkData);
            ui.showNotification(`Network "${networkData.name}" loaded successfully!`, 'success');
            closeLoadDialog();
        };
    }

    // Enhanced search functions
    function createSearchDropdown() {
        const searchContainer = document.querySelector('.search-container');
        const dropdown = document.createElement('div');
        dropdown.id = 'searchDropdown';
        dropdown.className = 'search-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            border: 1px solid var(--glass-border);
            border-radius: 15px;
            margin-top: 5px;
            max-height: 400px;
            overflow-y: auto;
            z-index: 1001;
            display: none;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        `;
        searchContainer.appendChild(dropdown);
    }

    async function showSearchSuggestions(query) {
        const dropdown = document.getElementById('searchDropdown');
        dropdown.innerHTML = '<div style="padding: 15px; text-align: center;">Searching...</div>';
        dropdown.style.display = 'block';
        isSearchDropdownOpen = true;

        try {
            const results = await api.searchMovie(query);
            if (results) {
                displaySearchResults([results], query);
            } else {
                dropdown.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--text-secondary);">No movies found</div>';
            }
        } catch (error) {
            dropdown.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--accent-color);">Search failed</div>';
        }
    }

    function displaySearchResults(results, query) {
        const dropdown = document.getElementById('searchDropdown');
        
        const resultsHtml = results.map(movie => `
            <div class="search-result-item" data-movie-id="${movie.ids.trakt}">
                <div class="movie-title">${highlightQuery(movie.title, query)}</div>
                <div class="movie-meta">
                    ${movie.year} ${movie.genres ? '• ' + movie.genres.slice(0, 2).join(', ') : ''}
                </div>
            </div>
        `).join('');

        dropdown.innerHTML = `
            <div style="padding: 10px 15px; border-bottom: 1px solid var(--glass-border); font-weight: bold; color: var(--gemini-accent);">
                Search Results
            </div>
            ${resultsHtml}
        `;

        // Add click handlers
        dropdown.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const movieId = item.dataset.movieId;
                const title = item.querySelector('div').textContent;
                selectMovieFromSearch(title);
                hideSearchDropdown();
            });
        });
    }

    function showRecentSearches() {
        if (recentSearches.length === 0) return;
        
        const dropdown = document.getElementById('searchDropdown');
        const recentHtml = recentSearches.slice(0, 5).map(search => `
            <div class="recent-search-item">
                🕒 ${search}
            </div>
        `).join('');

        dropdown.innerHTML = `
            <div style="padding: 10px 15px; border-bottom: 1px solid var(--glass-border); font-weight: bold; color: var(--gemini-accent);">
                Recent Searches
            </div>
            ${recentHtml}
        `;
        dropdown.style.display = 'block';
        isSearchDropdownOpen = true;

        // Add click handlers
        dropdown.querySelectorAll('.recent-search-item').forEach(item => {
            item.addEventListener('click', () => {
                const searchText = item.textContent.replace('🕒 ', '');
                document.getElementById('movieSearch').value = searchText;
                hideSearchDropdown();
                network.searchAndAddMovie();
            });
        });
    }

    function hideSearchDropdown() {
        const dropdown = document.getElementById('searchDropdown');
        dropdown.style.display = 'none';
        isSearchDropdownOpen = false;
    }

    function highlightQuery(text, query) {
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark style="background: var(--gemini-accent); color: var(--primary-color); padding: 1px 3px; border-radius: 3px;">$1</mark>');
    }

    function selectMovieFromSearch(title) {
        // Add to recent searches
        recentSearches = recentSearches.filter(search => search !== title);
        recentSearches.unshift(title);
        recentSearches = recentSearches.slice(0, 5);
        localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
        
        // Set search input and trigger search
        document.getElementById('movieSearch').value = title;
        network.searchAndAddMovie();
    }

    // Enhanced save dialog with better preview
    function showSaveDialog() {
        if (network.nodes.length === 0) {
            ui.showNotification('No network to save', 'error');
            return;
        }

        const modal = document.getElementById('saveModal');
        const preview = document.getElementById('savePreview');
        
        const totalMovies = network.nodes.length;
        const totalConnections = network.links.length;
        const seedMovie = network.nodes.find(n => n.depth === 0)?.title || 'Unknown';
        const maxDepth = Math.max(...network.nodes.map(n => n.depth));
        
        // Calculate average rating
        const ratingsSum = network.nodes.reduce((sum, node) => {
            const rating = node.fullDetails?.rating || node.basicDetails?.rating || 0;
            return sum + rating;
        }, 0);
        const avgRating = totalMovies > 0 ? (ratingsSum / totalMovies).toFixed(1) : 'N/A';
        
        // Get unique genres
        const genres = [...new Set(network.nodes.flatMap(n => {
            const details = n.fullDetails || n.basicDetails || {};
            return details.genres || [];
        }))];
        
        preview.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 13px; margin-bottom: 15px;">
                <div><strong>🎬 Movies:</strong> ${totalMovies}</div>
                <div><strong>🔗 Connections:</strong> ${totalConnections}</div>
                <div><strong>🎯 Seed Movie:</strong> ${seedMovie}</div>
                <div><strong>📊 Max Depth:</strong> ${maxDepth}</div>
                <div><strong>⭐ Avg Rating:</strong> ${avgRating}</div>
                <div><strong>🎭 Genres:</strong> ${genres.length}</div>
            </div>
            ${genres.length > 0 ? `
                <div style="margin-top: 10px;">
                    <strong>Top Genres:</strong> 
                    <div style="margin-top: 5px;">
                        ${genres.slice(0, 5).map(genre => 
                            `<span style="background: var(--glass-bg); padding: 2px 8px; border-radius: 10px; font-size: 11px; margin-right: 5px; display: inline-block; margin-bottom: 3px;">${genre}</span>`
                        ).join('')}
                        ${genres.length > 5 ? `<span style="color: var(--text-secondary); font-size: 11px;">+${genres.length - 5} more</span>` : ''}
                    </div>
                </div>
            ` : ''}
        `;
        
        const nameInput = document.getElementById('networkName');
        nameInput.value = seedMovie ? `${seedMovie} Network` : 'Movie Network';
        
        modal.style.display = 'flex';
        nameInput.focus();
    }

    // Enhanced network save with metadata
    async function saveNetwork() {
        const name = document.getElementById('networkName').value.trim();
        const description = document.getElementById('networkDescription').value.trim();
        
        if (!name) {
            ui.showNotification('Please enter a network name', 'error');
            return;
        }

        ui.showLoading(true);
        
        try {
            // Calculate enhanced metadata
            const totalMovies = network.nodes.length;
            const totalConnections = network.links.length;
            const maxDepth = Math.max(...network.nodes.map(n => n.depth));
            
            const ratingsSum = network.nodes.reduce((sum, node) => {
                const rating = node.fullDetails?.rating || node.basicDetails?.rating || 0;
                return sum + rating;
            }, 0);
            const averageRating = totalMovies > 0 ? (ratingsSum / totalMovies).toFixed(1) : 'N/A';
            
            const networkData = {
                name: name,
                description: description,
                nodes: network.nodes,
                links: network.links.map(link => ({
                    source: typeof link.source === 'object' ? link.source.id : link.source,
                    target: typeof link.target === 'object' ? link.target.id : link.target
                })),
                settings: {
                    showLabels: network.showLabels,
                    colorScheme: 'default'
                },
                seedMovie: network.nodes.find(n => n.depth === 0)?.title || null,
                metadata: {
                    totalMovies,
                    totalConnections,
                    maxDepth,
                    averageRating,
                    createdAt: new Date().toISOString(),
                    nodeCount: totalMovies,
                    linkCount: totalConnections
                }
            };

            // Check if network with same name exists
            let existingNetworks = [];
            try {
                existingNetworks = await api.getSavedNetworks();
            } catch (e) {
                console.log('Could not check existing networks');
            }
            
            const existingNetwork = existingNetworks.find(net => net.name === name);
            let result;
            
            if (existingNetwork) {
                // Network exists, update it
                console.log(`📝 Network "${name}" exists, updating...`);
                result = await api.updateNetworkOnServer(existingNetwork.id, networkData);
                ui.showNotification(`Network "${name}" updated successfully!`, 'success');
            } else {
                // New network, create it
                console.log(`📝 Creating new network "${name}"`);
                result = await api.saveNetworkToServer(networkData);
                ui.showNotification(`Network "${name}" saved successfully!`, 'success');
            }
            
            if (result.success) {
                closeSaveDialog();
                
                document.getElementById('networkName').value = '';
                document.getElementById('networkDescription').value = '';
            } else {
                ui.showNotification('Failed to save network', 'error');
            }
            
        } catch (error) {
            ui.showNotification('Failed to save network', 'error');
        } finally {
            ui.showLoading(false);
        }
    }

    // AI Integration Features
    async function generateNetworkInsights() {
        if (network.nodes.length === 0) {
            ui.showNotification('No network to analyze', 'error');
            return;
        }

        ui.showLoading(true);
        try {
            const networkData = {
                nodes: network.nodes,
                links: network.links
            };
            
            const analysis = await api.generateNetworkAnalysis(networkData);
            showAIInsightsModal(analysis);
            ui.showNotification('AI analysis generated!', 'success');
        } catch (error) {
            if (error.message.includes('AI service not available')) {
                ui.showNotification('AI features require Gemini API key. Check server configuration.', 'error');
                console.log('💡 To enable AI features:');
                console.log('1. Get API key from https://makersuite.google.com/app/apikey');
                console.log('2. Add GEMINI_API_KEY=your_key to .env file');
                console.log('3. Restart the server');
            } else if (error.message.includes('quota exceeded')) {
                ui.showNotification('AI quota exceeded. You have reached the daily limit of 50 free requests. Try again tomorrow!', 'warning');
                console.log('💡 Gemini API Free Tier Limits:');
                console.log('• 50 requests per day');
                console.log('• Resets every 24 hours');
                console.log('• Consider upgrading for higher limits: https://ai.google.dev/pricing');
            } else {
                ui.showNotification('Failed to generate AI insights: ' + error.message, 'error');
            }
        } finally {
            ui.showLoading(false);
        }
    }

    function showAIInsightsModal(analysis) {
        // Create AI insights modal if it doesn't exist
        let modal = document.getElementById('aiInsightsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'aiInsightsModal';
            modal.className = 'modal';
            modal.style.display = 'none';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>🤖 AI Network Analysis</h3>
                        <button class="close-btn" id="closeAiInsightsBtn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="aiAnalysisContent" style="line-height: 1.6; color: var(--text-color);"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="control-btn" id="closeAiInsightsFooterBtn">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        document.getElementById('aiAnalysisContent').innerHTML = `
            <div style="background: var(--glass-bg); padding: 15px; border-radius: 10px; border-left: 4px solid var(--gemini-accent);">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                    <span style="font-size: 20px;">🤖</span>
                    <strong style="color: var(--gemini-accent);">AI Analysis</strong>
                </div>
                <p style="margin: 0; white-space: pre-wrap;">${analysis}</p>
            </div>
            <div style="margin-top: 15px; font-size: 12px; color: var(--text-secondary); text-align: center;">
                Powered by Google Gemini AI
            </div>
        `;
        
        modal.style.display = 'flex';
        
        // Add event listeners for close buttons
        const closeBtn = document.getElementById('closeAiInsightsBtn');
        const closeFooterBtn = document.getElementById('closeAiInsightsFooterBtn');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
        
        if (closeFooterBtn) {
            closeFooterBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
    }

    // Enhanced movie details with AI synopsis
    async function enhanceMovieWithAI(node) {
        if (!node.fullDetails?.overview) return;
        
        try {
            const synopsis = await api.generateMovieSynopsis(node.title, node.fullDetails.overview);
            node.aiSynopsis = synopsis;
            ui.updateSidebar(network.nodes); // Refresh sidebar to show AI synopsis
        } catch (error) {
            console.log('AI synopsis not available:', error.message);
        }
    }

    // Check AI availability on startup
    async function checkAIAvailability() {
        try {
            const health = await api.checkAIHealth();
            if (health.status === 'healthy') {
                console.log('✅ AI features available');
                addAIButton(true); // AI is working
            } else {
                console.log('⚠️ AI features not available:', health.reason);
                addAIButton(false, health.reason); // AI not working, show grayed out
            }
        } catch (error) {
            console.log('❌ AI service check failed');
            addAIButton(false, 'AI service unavailable'); // Show grayed out with error
        }
    }

    function addAIButton(isHealthy = true, reason = '') {
        const controls = document.querySelector('.controls');
        if (controls && !document.getElementById('aiBtn')) {
            console.log('🔧 Adding AI button to controls');
            const aiBtn = document.createElement('button');
            aiBtn.id = 'aiBtn';
            aiBtn.className = 'control-btn';
            aiBtn.innerHTML = '🤖 AI Insights';
            
            if (isHealthy) {
                // AI is working - normal button
                aiBtn.title = 'Generate AI analysis of your network';
                aiBtn.addEventListener('click', () => generateNetworkInsights());
            } else {
                // AI not working - grayed out button
                aiBtn.style.opacity = '0.5';
                aiBtn.style.cursor = 'not-allowed';
                aiBtn.style.filter = 'grayscale(1)';
                
                // Set helpful tooltip based on reason
                let tooltip = 'AI features unavailable';
                if (reason.includes('quota') || reason.includes('429')) {
                    tooltip = 'AI quota exceeded - Try again tomorrow or upgrade plan';
                } else if (reason.includes('API key') || reason.includes('key not configured')) {
                    tooltip = 'AI requires Gemini API key configuration';
                } else {
                    tooltip = `AI unavailable: ${reason}`;
                }
                aiBtn.title = tooltip;
                
                // Show helpful message when clicked
                aiBtn.addEventListener('click', () => {
                    if (reason.includes('quota') || reason.includes('429')) {
                        ui.showNotification('AI quota exceeded. You have reached the daily limit. Try again tomorrow!', 'warning');
                    } else if (reason.includes('API key') || reason.includes('key not configured')) {
                        ui.showNotification('AI requires Gemini API key. Check server configuration.', 'error');
                    } else {
                        ui.showNotification(`AI features unavailable: ${reason}`, 'error');
                    }
                });
            }
            
            // Insert before the color mode select to maintain order
            // Just append the AI button to controls since color mode is now in sidebar
            controls.appendChild(aiBtn);
            console.log('✅ AI button appended to controls');
        } else if (!controls) {
            console.log('❌ Controls container not found');
        } else {
            console.log('ℹ️ AI button already exists');
        }
    }

    // Global TTS functions for onclick handlers
    window.playMovieOverview = async (title, overview) => {
        try {
            ui.showNotification('🔊 Starting audio...', 'info');
            await tts.playMovieOverview(title, overview);
            ui.showNotification('🎵 Audio playback started', 'success');
        } catch (error) {
            console.error('TTS Error:', error);
            ui.showNotification(`Audio failed: ${error.message}`, 'error');
        }
    };

    window.stopTTS = () => {
        tts.stop();
        ui.showNotification('⏹️ Audio stopped', 'info');
    };

    setupGlobalEventListeners();
    checkAIAvailability(); // Check if AI features are available
    
    // Initialize the color sidebar with default mode
    if (network) {
        network.currentColorMode = 'depth'; // Ensure the mode is set
        network.updateColorLegend('depth'); // Initialize with depth mode
    }
});