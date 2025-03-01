const Mode = {SEGMENT:'segment',EDIT:'edit',LINES:'lines',TEXT:'text'}
const PageStatus = {TODO:'statusTodo',SESSIONSAVED:'statusSession',SERVERSAVED:'statusServer',UNSAVED:'statusUnsaved'}
const ElementType = {SEGMENT:'segment',AREA:'area',TEXTLINE:'textline',CUT:'cut',CONTOUR:'contour',SUBTRACT:"subtract"}
const SegmentTypes = [
	"TextRegion",
	"ImageRegion",
	"LineDrawingRegion",
	"GraphicRegion",
	"TableRegion",
	"ChartRegion",
	"MapRegion",
	"SeparatorRegion",
	"MathsRegion",
	"ChemRegion",
	"MusicRegion",
	"AdvertRegion",
	"NoiseRegion",
	"UnknownRegion",
	"CustomRegion"
]

function Controller(bookID, accessible_modes, canvasID, regionColors, colors, globalSettings) {
	const _actionController = new ActionController(this);
	const _communicator = new Communicator();
	const _colors = new Colors(colors,regionColors);
	this.textlineRegister = {};
	let _mode = accessible_modes[0];
	let _selector;
	let _gui;
	let _guiInput;
	let _navigationController;
	let _editor;
	let _textViewer;
	let _currentPage;
	let _hoveredElement;
	let _segmentedPages = [];
	let _savedPages = [];
	let _book;
	let _segmentation = {};
	let _settings;
	let _contours = {};
	let _presentRegions = [];
	let _tempID = null;
	let _allowLoadLocal = true;
	let _autoSegment = true;
	let _visibleRegions = {}; // !_visibleRegions.contains(x) and _visibleRegions[x] == false => x is hidden
	let _fixedGeometry = {};
	let _editReadingOrder = false;
	let _move = false;

	let _newPolygonCounter = 0;
	let _pastId;
	let _initialTextView = true;
	this._imageVersion = 0;

	this.get_segmentation = function(current_page){
		if(current_page)
			return _segmentation[_currentPage]
		return _segmentation
	}

	this.get_saved_pages = function(){
		return _savedPages;
	}

	this.get_segmented_pages = function(){
		return _segmentedPages;
	}

	// Unsaved warning
	window.onbeforeunload = () =>  {
		let reloading = sessionStorage.getItem("reloading");
		if(reloading != "false") {
			sessionStorage.setItem("reloading", "true");
		}
		if(!this.isCurrentPageSaved() && _actionController.hasActions(_currentPage)){
			// Warning message if browser supports it
			return 'You have unsaved progress. Leaving the page will discard every change.\n'
					+'Please consider saving your progress with "Save Result" or CTRL+S';
		}
	};

	// main method
	$(window).ready(() => {
		// Init PaperJS
		paper.setup(document.getElementById(canvasID));
		sessionStorage.setItem("reloading", "true");
		//set height before data is loaded //TODO rework
		let $canvas = $("canvas");
		let $sidebars = $('.sidebar');
		const height = $(window).height() - $canvas.offset().top;
		$canvas.height(height);
		$sidebars.height(height);

		_currentPage = 0;
		this.showPreloader(true);
		_communicator.getOCR4allMode().done((ocr4allMode) => {
			if(ocr4allMode){
				$("#openDir").hide();
			}
		});
		_communicator.loadBook(bookID).done((book) => {
			_book = book;

			// Init the viewer
			const viewerInput = new ViewerInput(this);

			// Inheritance Editor extends Viewer
			_editor = new Editor(viewerInput, _colors, this);

			// Create Text Viewer
			_textViewer = new TextViewer();

			_selector = new Selector(_editor, _textViewer, this);
			viewerInput.selector = _selector;
			_actionController.selector = _selector;
			_gui = new GUI(canvasID, _editor, _colors, accessible_modes);
			_gui.resizeViewerHeight();
			_gui.loadVisiblePreviewImages();
			_gui.highlightSegmentedPages(_segmentedPages);

			_gui.setPageXMLVersion("2019-07-15");

			_gui.createSelectColors();
			_gui.updateAvailableColors();
			_gui.addPreviewImageListener();
			_communicator.getVirtualKeyboard().done((keyboard) => {
				_gui.setVirtualKeyboard(keyboard);
			});
			_navigationController = new NavigationController(_gui,_editor,this.getMode);
			viewerInput.navigationController = _navigationController;
			// setup paper again because of pre-resize bug
			// (streched)
			paper.setup(document.getElementById(canvasID));


			// Init inputs
			const keyInput = new KeyInput(_navigationController, this, _gui, _textViewer, _selector, ["#"+canvasID,"#viewer","#textline-content"]);
			$("#"+canvasID).click(() => keyInput.isActive = true);
			$("#"+canvasID).mouseover(() => keyInput.isActive = true);
			$("#"+canvasID).find("input").focusin(() => keyInput.isActive = false);
			$("#"+canvasID).find("input").focusout(() => keyInput.isActive = true);

			$(".sidebar").find("input").focusin(() => keyInput.isActive = false);
			$(".sidebar").find("input").focusout(() => keyInput.isActive = true);
			$("#regioneditor").find("input").focusin(() => keyInput.isActive = false);
			$("#regioneditor").find("input").focusout(() => keyInput.isActive = true);
			$("#virtual-keyboard-add").find("input").focusin(() => keyInput.isActive = false);
			$("#virtual-keyboard-add").find("input").focusout(() => keyInput.isActive = true);
			_guiInput = new GuiInput(_navigationController, this, _gui, _textViewer, _selector, _communicator);

			this.showPreloader(false);

			// on resize
			$(window).resize(() => {
				_gui.resizeViewerHeight();
				if(_mode === Mode.TEXT && _gui.isTextLineContentActive()){
					_gui.placeTextLineContent();
				}
			});

			// init Search
			$(document).ready(function(){
				let pageData = {};
				_book.pages.forEach(page => pageData[page.images[0]] = null );
			});

			// Add settings if mode is included
			_communicator.getSettings(bookID).done((settings) => {
				_settings = settings;
				const regions = _settings.regions;
				Object.keys(regions).forEach((key) => {
					const region = regions[key];

					if (region.type !== 'ignore' && $.inArray(region.type, _presentRegions) < 0) {
						_presentRegions.push(region.type);
					}
				});
				_gui.setParameters(_settings.parameters, _settings.imageSegType, _settings.combine);
				this.displayPage(0);
			});

			this.setMode(_mode);
		});
	});

	this.displayPage = function (pageNr, imageNr=this._imageVersion, empty=false) {
		this.escape();
		_currentPage = pageNr;
		_gui.updateSelectedPage(_currentPage);

		const imageId = _book.pages[_currentPage].id + "image" + imageNr;
		// Check if image is loadedreadingOrder
		const image = $('#' + imageId);
		if (!image[0]) {
			if(_book.pages[_currentPage].images[imageNr] === undefined){
				_communicator.loadImage(_book.pages[_currentPage].images[0], imageId).done(() => this.displayPage(pageNr, imageNr));
				this.setImageVersion(0);
			}else{
				_communicator.loadImage(_book.pages[_currentPage].images[imageNr], imageId).done(() => this.displayPage(pageNr, imageNr));
			}
			return false;
		}
		if (!image[0].complete) {
			// break until image is loaded
			image.load(() => this.displayPage(pageNr));
			return false;
		}
		this.showPreloader(true);

		//// Set Editor and TextView
		_editor.clear();
		_editor.setImage(imageId);
		_navigationController.zoomFit();
		_textViewer.clear();
		_textViewer.setImage(imageId);

		_textViewer.setLoading(true);

		// Check if page is to be segmented or if segmentation can be loaded
		if (_segmentedPages.indexOf(_currentPage) < 0 && _savedPages.indexOf(_currentPage) < 0) {
			_gui.updateOrientation(0);
			_communicator.getHaveAnnotations(_book.id).done((pages) =>{
				if(_allowLoadLocal && pages.includes(_currentPage) && !empty){
					this.loadAnnotations();
				} else if(_autoSegment){
					this.requestSegmentation();
				} else {
					this._requestEmptySegmentation();
				}
				pages.forEach(page => { _gui.addPageStatus(page, PageStatus.SERVERSAVED)});
			})
		} else {
			const pageSegments = _segmentation[_currentPage] ? _segmentation[_currentPage].segments : null;

			this.textlineRegister = {};
			if (pageSegments) {
				//Rotate Image according to /PcGts/Page/@orientation
				_gui.updateOrientation(_segmentation[_currentPage].orientation);
				_editor.rotateImage(_segmentation[_currentPage].orientation, _segmentation.center);
				// Iterate over Segment-"Map" (Object in JS)
				Object.keys(pageSegments).forEach((key) => {
					const pageSegment = pageSegments[key];
					_editor.addSegment(pageSegment, this.isSegmentFixed(key));
					if(pageSegment.textlines){
						Object.keys(pageSegment.textlines).forEach((linekey) => {
							const textLine = pageSegment.textlines[linekey];
							if(textLine.text && 0 in textLine.text){
								textLine.type = "TextLine_gt";
							} else {
								textLine.type = "TextLine";
							}
							_editor.addTextLine(textLine);
							_textViewer.addTextline(textLine);
							if(textLine["baseline"]){
								_editor.addBaseline(textLine, textLine["baseline"]);
							}
							this.textlineRegister[textLine.id] = pageSegment.id;
						});
					}
				});
				_textViewer.orderTextlines(_selector.getSelectOrder(ElementType.TEXTLINE));
			}

			const regions = _settings.regions;
			// Iterate over Regions-"Map" (Object in JS)
			Object.keys(regions).forEach((key) => {
				const region = regions[key];
				if(!_colors.hasColor(region.type)){
					_colors.assignAvailableColor(region.type);
				}

				// Iterate over all Areas of a Region
				Object.keys(region.areas).forEach((areaKey) => {
					let polygon = region.areas[areaKey];
					_editor.addArea(polygon);

					if (!_visibleRegions[region.type] && region.type !== 'ignore') {
						_editor.hideSegment(polygon.id, true);
					}
				});

				if (region.type !== 'ignore' && $.inArray(region.type, _presentRegions) < 0) {
					//_presentRegions does not contains region.type
					_presentRegions.push(region.type);
				}
			});

			if(!_fixedGeometry[_currentPage])
				_fixedGeometry[_currentPage] = {segments:[],cuts:{}};

			const pageCuts = _fixedGeometry[_currentPage].cuts;
			// Iterate over FixedSegment-"Map" (Object in JS)
			Object.keys(pageCuts).forEach((key) => _editor.addLine(pageCuts[key]));

			_navigationController.zoomFit();

			if(_textViewer.isOpen()){
				_textViewer.displayZoom();
				_textViewer._displayPredictedText();
			}
			_textViewer.setLoading(false);


			//// Set GUI
			_gui.showUsedRegionLegends(_presentRegions);
			this.displayReadingOrder(false);
			_gui.updateRegionLegendColors(_presentRegions);
			_gui.resetSidebarActions();

			_gui.selectPage(pageNr, imageNr);
			this.fillMetadataModal();
			this.endEditReadingOrder();
			this.showPreloader(false);

			// Open current Mode
			this.setMode(_mode);
		}
	}

	this.setImageVersion = function(imageVersion) {
		this._imageVersion = imageVersion;
	}

	this.loadLibrary = function () {
		sessionStorage.setItem("reloading", "false")
		document.location.reload();
	}

	this.reloadProject = function () {
		sessionStorage.setItem("reloading", "true")
		document.location.reload();
	}

	this.redo = function () {
		_actionController.redo(_currentPage);
	}
	this.undo = function () {
		_actionController.undo(_currentPage);
	}

	this.addPresentRegions = function (regionType) {
		if (regionType !== 'ignore' && $.inArray(regionType, _presentRegions) < 0) {
			//_presentRegions does not contains region.type
			_presentRegions.push(regionType);
		}
		_gui.showUsedRegionLegends(_presentRegions);
	}
	this.removePresentRegions = function (regionType) {
		_presentRegions = jQuery.grep(_presentRegions, (value) => value !== regionType);
		_gui.showUsedRegionLegends(_presentRegions);
	}

	this.loadAnnotations = function () {
		_actionController.resetActions(_currentPage);
		//Update setting parameters
		_communicator.getPageAnnotations(_book.id, _currentPage).done((result) => {
			if(!result){
				_gui.displayWarning("Couldn't retrieve annotations from file.", 4000, "red");
				this.displayPage(_currentPage, this._imageVersion, true);
			}else{
				this.rotateAnnotations(result);
				this._setPage(_currentPage, result);
				this.displayPage(_currentPage);
			}

		});
	}

	this.requestBatchSegmentation = function (allowLoadLocal, pages, save, progressInterval, doReadingOrder, roMode) {
		const _batchSegmentationPreloader = $("#batch-segmentation-progress")
		_batchSegmentationPreloader.show();

		//Update setting parameters
		_settings.parameters = _gui.getParameters();

		//Add fixed Segments to settings
		const activesettings = JSON.parse(JSON.stringify(_settings));
		let pagesWithOrientation = new Map();
		for(let page = 0; page < pages.length; page++) {
			activesettings.fixedGeometry = {segments: {}, cuts: {}};
			if (_fixedGeometry[page]) {
				if (_fixedGeometry[page].segments)
					_fixedGeometry[page].segments.forEach(
						s => activesettings.fixedGeometry.segments[s] = _segmentation[page].segments[s]);
				if (_fixedGeometry[page].cuts)
					activesettings.fixedGeometry.cuts = JSON.parse(JSON.stringify(_fixedGeometry[page].cuts));
			}
			if(_segmentation[page] != null) {
				pagesWithOrientation[page] = _segmentation[page].orientation;
			} else {
				pagesWithOrientation[page] = 0;
			}
		}
		_communicator.batchSegmentPage(activesettings, pagesWithOrientation, _book.id, _gui.getPageXMLVersion()).done((results) => {
			for (const [index, result] of results.entries()) {
				this.rotateAnnotations(result);
				this.setChanged(pages[index]);
				this._setPage(pages[index], result);
			}
			this.displayPage(pages[0])
			_gui.displayWarning("Batch segmentation successful.", 1500, "green")
			if(doReadingOrder) {
				try {
					this.batchGenerateReadingOrder(pages, roMode);
				} catch (error) {
					console.log(error);
				}
			}
			if(save) {
				this.requestBatchExport(pages, progressInterval,false,roMode);
			} else {
				_batchSegmentationPreloader.hide();
				clearInterval(progressInterval);
				$(".modal").modal("close");
			}
		});
	}
	this.batchGenerateReadingOrder = function ( pages, roMode) {
		if(pages.length !== 0) {
			switch (roMode) {
				case "automatic":
					this.batchAutoReadingOrder(pages);
					break;
				default:
					console.log("Reading order '" + roMode + "' defaults to automatic");
					this.batchAutoReadingOrder(pages);
					break;
			}
			for (let i = 0; i < pages.length; i++) {
				this.setChanged(pages[i]);
			}
			_gui.displayWarning("Batch Reading Order successful.", 1500, "green")
		} else {
			_gui.displayWarning("Failed! No Segmentation for selected pages ", 1500, "red");
		}
	}
	this.batchAutoReadingOrder = function (pages) {
		for(let i = 0; i<pages.length; i++) {
			try {
				this.autoGenerateReadingOrder(pages[i]);
			} catch (e) {
				console.log("page " + i + " could not be loaded!")
				console.log(e);
			}

		}
	}
	this.checkPagesForSegmentation = function (pages) {
		let segPages = Array.from(pages);
		let i=0;
		while(i < segPages.length) {
			if (typeof _segmentation[segPages[i]] == 'undefined') {
				segPages.splice(i, 1);
			} else {
				i++;
			}
		}
		if(pages.length > segPages.length) {
			_gui.displayWarning("Reading Order and Export could not be executed for pages without segmentation.", 1500, "orange");
		}

		return segPages;
	}

	this.handleBatch = function (selected_pages, doReadingOrder, roMode, batchSeg, batchExp) {
		/* Collect local page annotations into segmentation map before running batch */
		_communicator.getPageAnnotationsBatch(_book.id, selected_pages.toArray()).done((result) => {
			if (!result) {
				console.log("Server error while loading pages");
			} else {
				for (let i = 0; i < selected_pages.toArray().length; i++) {
					if(result[i].status !== "EMPTY"){
						_actionController.resetActions(selected_pages.toArray()[i]);
						result[i] = this.rotateAnnotations(result[i]);
						this._setPage(selected_pages.toArray()[i], result[i]);
					}
				}
			}
			_gui.updateSelectedPage(_currentPage);
			$("#runBatch").removeClass("disabled");

			let progress = 0;
			let progressInterval = setInterval(() => {
				_communicator.getBatchSegmentationProgress().done(function (data) {
					setTimeout(function () {
						progress = Math.round((data / selected_pages.toArray().length) * 100);
						console.log("progress: " + progress);
						$("#batch-segmentation-progress").css('width', progress + '%');
					});
				})
			},1000)

			if(batchSeg) {
				this.requestBatchSegmentation(false, selected_pages.toArray(), $("#batchSaveSegmentation").is(":checked"),
					progressInterval, doReadingOrder, roMode);
			}else if(batchExp && !(batchSeg)) {
				selected_pages = this.checkPagesForSegmentation(selected_pages);
				this.requestBatchExport(selected_pages,progressInterval, doReadingOrder, roMode);
			}else if(!(batchExp) && !(batchSeg) && doReadingOrder) {
				selected_pages = this.checkPagesForSegmentation(selected_pages);
				clearInterval(progressInterval);
				$(".modal").modal("close");
				this.batchGenerateReadingOrder(selected_pages, roMode);
			}
		});
	}
	this.requestBatchExport = function (pages, progressInterval, doReadingOrder, roMode) {
		if(pages.length === 0) {
			clearInterval(progressInterval);
			$("#batch-segmentation-progress").css('width', '0%');
			$(".modal").modal("close");
			_gui.displayWarning("Failed! No Segmentation for selected pages ", 1500, "red");
			return;
		}
		if(doReadingOrder) {
			this.batchGenerateReadingOrder(pages,roMode);
		}
		const _batchSegmentationPreloader = $("#batch-segmentation-progress")
		_batchSegmentationPreloader.show();

		//Update setting parameters
		_settings.parameters = _gui.getParameters();
		let segmentations = [];
		for(let pageI = 0; pageI < pages.length; pageI++) {
			if(_segmentation[pages[pageI]] != null && !isEmpty(_segmentation[pages[pageI]].segments)) {
				_segmentation[pages[pageI]] = this.unrotateSegments(_segmentation[pages[pageI]]);
				segmentations.push(_segmentation[pages[pageI]]);
			}
		}
		_communicator.batchExportPage(_book.id, pages,segmentations,_gui.getPageXMLVersion()).then((data) => {
			for(let pageI = 0; pageI < pages.length; pageI++) {
				_savedPages.push(pages[pageI]);
				_gui.addPageStatus(pages[pageI],PageStatus.SERVERSAVED);
			}

			if(globalSettings.downloadPage) {
				try {
					let a = window.document.createElement('a');
					a.href = window.URL.createObjectURL(new Blob([data], {type: "application/zip; charset=utf-8"}));
					a.download = _book.name + "_" + "archive" + ".zip";
					document.body.appendChild(a);
					a.click();
				} catch (err) {
					console.log(err);
					console.log(err.stack);
				}
			}
		});
		for(let pageI = 0; pageI < pages.length; pageI++) {
			if(_segmentation[pages[pageI]] != null) {
				_segmentation[pages[pageI]] = this.rotateAnnotations(_segmentation[pages[pageI]]);
			}
		}
		this.displayPage(pages[0])
		clearInterval(progressInterval);
		_batchSegmentationPreloader.hide();
		$("#batch-segmentation-progress").css('width', '0%');
		$(".modal").modal("close");
		_gui.displayWarning("Batch export successful.", 1500, "green")
	}
	this.getLoadLocalSetting = function () {
		return _allowLoadLocal;
	}
	this.requestSegmentation = function (allowLoadLocal) {
		//Update setting parameters
		_settings.parameters = _gui.getParameters();

		this.setChanged(_currentPage);

		//Add fixed Segments to settings
		const activesettings = JSON.parse(JSON.stringify(_settings));
		activesettings.fixedGeometry = {segments:{},cuts:{}};
		if (_fixedGeometry[_currentPage]) {
			if (_fixedGeometry[_currentPage].segments) {
				_fixedGeometry[_currentPage].segments.forEach(
					s => activesettings.fixedGeometry.segments[s] = _segmentation[_currentPage].segments[s]);
				if(activesettings.fixedGeometry != null && _segmentation[_currentPage].orientation != 0) {
					activesettings.fixedGeometry = this.unrotateFixedGeometry(activesettings.fixedGeometry, _segmentation[_currentPage]);
				}
			}
			if (_fixedGeometry[_currentPage].cuts)
				activesettings.fixedGeometry.cuts = JSON.parse(JSON.stringify(_fixedGeometry[_currentPage].cuts));
		}
		const action = new ActionSegmentPage(_segmentation[_currentPage], activesettings, allowLoadLocal, _currentPage, _communicator,
			this);
		_actionController.addAndExecuteAction(action, _currentPage);
	}

	this._requestEmptySegmentation = function () {
		_communicator.emptySegmentation(_book.id, _currentPage).done((result) => {
			_gui.highlightLoadedPage(_currentPage, false);
			this._setPage(_currentPage, result);
			this.displayPage(_currentPage);
		});
		_segmentedPages.push(_currentPage);
	}

	this._setPage = function(pageid, result){
		_pastId = null;

		const missingRegions = [];

		_gui.highlightLoadedPage(pageid, false);

		function preparePage(_controller){
			_segmentation[pageid] = result;

			//check if all necessary regions are available
			Object.keys(result.segments).forEach((id) => {
				let segment = result.segments[id];
				if ($.inArray(segment.type, _presentRegions) === -1) {
					//Add missing region
					_controller.changeRegionSettings(segment.type, 0, -1);
					if(!_colors.hasColor(segment.type)){
						_colors.assignAvailableColor(segment.type)
						const colorID = _colors.getColorID(segment.type);
						_controller.setRegionColor(segment.type,colorID);
					}
					missingRegions.push(segment.type);
				}
			});
			_controller.forceUpdateReadingOrder();
		}

		switch (result.status) {
			case 'LOADED':
				_gui.highlightLoadedPage(pageid, true);
				preparePage(this);
				break;
			case 'SUCCESS':
			case 'EMPTY':
				preparePage(this);
				break;
			default:
		}

		_segmentedPages.push(pageid);
		if (missingRegions.length > 0) {
			_gui.displayWarning('Warning: Some regions were missing and have been added.');
		}

		_gui.highlightSegmentedPages(_segmentedPages);
	}

	this.adjacentPage = function(direction){
		let _newPage;

		switch (direction) {
			case "prev":
				_newPage = _currentPage - 1;
				if ($(`.changePage[data-page="${_newPage}" ]`).length) {
					_gui.updateSelectedPage(_newPage);
					this.displayPage(_newPage)
				}
				break;
			case "next":
				_newPage = _currentPage + 1;
				if ($(`.changePage[data-page="${_newPage}" ]`).length) {
					_gui.updateSelectedPage(_newPage);
					this.displayPage(_newPage)
				}
				break;
		}
	}

	this.uploadSegmentation = function (file) {
		this.showPreloader(true);

		_communicator.uploadPageXML(file, _currentPage, _book.id).done((page) => {
			if(!page){
				_gui.displayWarning("Couldn't retrieve annotations from file.", 4000, "red");
				this.displayPage(_currentPage, this._imageVersion, true);
			}else{
				this._setPage(_currentPage,page);
				this.displayPage(_currentPage);
			}
			this.showPreloader(false);
		});
	}

	this.setMode = function(mode){
		let selected = _selector.getSelectedSegments();
		_selector.unSelect();

		_gui.setMode(mode);

		if(_mode !== mode) {
			this.endEditing();
		}

		_mode = mode;
		if(mode === Mode.SEGMENT || mode === Mode.EDIT){
			// Map selected items to this view
			selected = selected.map(id => (this.getIDType(id) === ElementType.TEXTLINE) ? this.textlineRegister[id] : id);
			// Set visibilities
			_editor.displayOverlay("segments",true);
			_editor.displayOverlay("areas",true);
			_editor.displayOverlay("lines",false);
			this.displayTextViewer(false);
			if(_segmentation[_currentPage]){
				_gui.setReadingOrder(_segmentation[_currentPage].readingOrder,_segmentation[_currentPage].segments);
			}else{
				_gui.setReadingOrder([],{});
			}
			this.forceUpdateReadingOrder();
		} else if(mode === Mode.LINES){
			// Map selected items to this view
			selected = selected.filter(id => [ElementType.TEXTLINE,ElementType.SEGMENT].includes(this.getIDType(id)));
			// Set visibilities
			_editor.displayOverlay("segments",true);
			_editor.displayOverlay("areas",false);
			_editor.displayOverlay("lines",true);
			this.forceUpdateReadingOrder();
			this.displayTextViewer(false);
		} else if(mode === Mode.TEXT){
			const postSelect = [];
			// Map selected items to this view
			for(const id of selected){
				const type = this.getIDType(id);
				if(type === ElementType.SEGMENT){
					const order = _selector.getSelectOrder(ElementType.TEXTLINE,false,id);
					if(order && order.length > 0) {
						postSelect.push(order[0]);
					}
				} else if(type === ElementType.TEXTLINE){
					postSelect.push(id);
				}
			}
			selected = postSelect;
			// Set visibilities
			_editor.displayOverlay("segments",false);
			_editor.displayOverlay("areas",false);
			_editor.displayOverlay("lines",true);
			this.displayReadingOrder(false);
			_initialTextView ? (this.displayTextViewer(true), _initialTextView = false) : this.displayTextViewer(_textViewer.isOpen());
		}

		// Post Selection
		const wasMultiple = _selector.selectMultiple;
		_selector.selectMultiple = true;
		for(const id of selected){
			_selector.select(id);
		}
		_selector.selectMultiple = wasMultiple;
	}

	this.getMode = function(){
		return _mode;
	}

	this.exportPageXML = function (_page = _currentPage) {
		if(_segmentation[_currentPage] != null && !isEmpty(_segmentation[_currentPage].segments)) {
			_segmentation[_currentPage] = this.unrotateSegments(_segmentation[_currentPage]);
		}
		_gui.setExportingInProgress(true);
		_communicator.exportSegmentation(_segmentation[_page], _book.id, _gui.getPageXMLVersion()).done((data) => {
			// Set export finished
			_savedPages.push(_page);
			_gui.setExportingInProgress(false);
			_gui.addPageStatus(_page,PageStatus.SESSIONSAVED);

			// Download
			if (globalSettings.downloadPage) {
				let a = window.document.createElement('a');
				a.href = window.URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(data)], { type: "text/xml;charset=utf-8" }));
				const fileName = _book.pages[_page].name;
				a.download = _book.name + "_" + fileName + ".xml";

				// Append anchor to body.
				document.body.appendChild(a);
				a.click();
			}
			//Update setting parameters
			_communicator.getPageAnnotations(_book.id, _currentPage).done((result) => {
				if(!result){
					_gui.displayWarning("Couldn't retrieve annotations from file.", 4000, "red");
					this.displayPage(_currentPage, this._imageVersion, true);
				}else{
					// TODO: The display shouldn't be completely reset on saving. The background image and the current panning zoom should be kept.
					_segmentation[_currentPage] = this.rotateAnnotations(result);
					this.displayPage(_currentPage, this._imageVersion, false);
				}

			});

		});
	}

	this.isCurrentPageSaved = function(){
		return _savedPages.includes(_currentPage);
	}

	this.setChanged = function(pageID){
		_savedPages = _savedPages.filter(id => id !== pageID);

		_gui.addPageStatus(pageID,PageStatus.UNSAVED);
	}

	this.saveSettingsXML = function () {
		_gui.setSaveSettingsInProgress(true);
		_settings.parameters = _gui.getParameters();
		_communicator.exportSettings(_settings).done((data) => {
			let a = window.document.createElement('a');
			a.href = window.URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(data)], { type: "text/xml;charset=utf-8" }));
			a.download = "settings_" + _book.name + ".xml";

			// Append anchor to body.
			document.body.appendChild(a);
			a.click();

			// Remove anchor from body
			document.body.removeChild(a);

			_gui.setSaveSettingsInProgress(false);
		});
	}

	/**
	 * Save the current virtual keyboard as file
	 */
	this.saveVirtualKeyboard = function () {
		const virtualKeyboard = _gui.getVirtualKeyboard(asRaw=true);
		const a = window.document.createElement('a');
		a.href = window.URL.createObjectURL(new Blob([virtualKeyboard], { type: "text/xml;charset=utf-8" }));
		a.download = "virtual-keyboard.txt";

		// Append anchor to body.
		document.body.appendChild(a);
		a.click();

		// Remove anchor from body
		document.body.removeChild(a);
	}

	this.uploadSettings = function (file) {
		_communicator.uploadSettings(file, _book.id).done((settings) => {
			if (settings) {
				_settings = settings;
				_presentRegions = [];
				Object.keys(_settings.regions).forEach((regionType) => {
					if (regionType !== 'ignore') {
						_presentRegions.push(regionType);
					}
				});
				_gui.showUsedRegionLegends(_presentRegions);
				_gui.setParameters(_settings.parameters, _settings.imageSegType, _settings.combine);

				this.displayPage(_currentPage);
				this.hideAllRegionAreas(true);
				_gui.forceUpdateRegionHide(_visibleRegions);
				_actionController.resetActions(_currentPage);
			}
		});
	}

	this.fixSegment = function (id, doFix = true) {
		let arrayPosition = $.inArray(id, _fixedGeometry[_currentPage].segments);
		if (doFix && arrayPosition < 0) {
			_fixedGeometry[_currentPage].segments.push(id)
		} else if (!doFix && arrayPosition > -1) {
			//remove from fixed segments
			_fixedGeometry[_currentPage].segments.splice(arrayPosition, 1);
		}
		_editor.fixSegment(id, doFix);
	}

	this.createSegmentPolygon = function () {
		this.endEditing();
		_editor.startCreatePolygon(ElementType.SEGMENT);
		_gui.selectToolBarButton('segmentPolygon', true);
	}
	this.createSubtractPolygon = function () {
		this.endEditing();
		_editor.startCreatePolygon(ElementType.SUBTRACT);
		_gui.selectToolBarButton('subtractPolygon', true);
	}
	this.createTextLinePolygon = function () {
		const selected = _selector.getSelectedSegments();
		if(selected.length > 0 &&
			(_selector.selectedType === ElementType.SEGMENT && this.isIDTextRegion(selected[0])) ||
			(_selector.selectedType === ElementType.TEXTLINE && this.isIDTextRegion(this.textlineRegister[selected[0]]))) {
			this.endEditing();
			_tempID = _selector.selectedType === ElementType.SEGMENT ? selected[0] : this.textlineRegister[selected[0]];
			// Check if segment region is a TextRegion
			if(this.isIDTextRegion(_tempID)){
				_editor.startCreatePolygon(ElementType.TEXTLINE);
				_gui.selectToolBarButton('textlinePolygon', true);
			}
		}else{
			_gui.displayWarning('Warning: Can only create TextLines if a TextRegion has been selected before hand.');
		}
	}
	this.createRectangle = function (type) {
		this.endEditing();

		// Check for TextLine
		if(type === ElementType.TEXTLINE ){
			const selected = _selector.getSelectedSegments();

			if(selected.length > 0 &&
				(_selector.selectedType === ElementType.SEGMENT && this.isIDTextRegion(selected[0])) ||
				(_selector.selectedType === ElementType.TEXTLINE && this.isIDTextRegion(this.textlineRegister[selected[0]]))) {

				_tempID = _selector.selectedType === ElementType.TEXTLINE ? this.textlineRegister[selected[0]] : selected[0];
			}else{
				_gui.displayWarning('Warning: Can only create TextLines if a TextRegion has been selected before hand.');
				return;
			}
		}
		_editor.createRectangle(type);
		switch (type) {
			case ElementType.SEGMENT:
				_gui.selectToolBarButton('segmentRectangle', true);
				break;
			case ElementType.AREA:
				_gui.selectToolBarButton('regionRectangle', true);
				break;
			case ElementType.TEXTLINE:
				_gui.selectToolBarButton('textlineRectangle', true);
				break;
			case 'ignore':
				_gui.selectToolBarButton('ignore', true);
				break;
			case 'roi':
				_gui.selectToolBarButton('roi', true);
				break;
			case 'subtract':
				_gui.selectToolBarButton('subtractRectangle', true);
		}
	}

	this.subtractSegment = function(points) {
		/**
		 * Subtracts the intersected area of a subtraction rectangle or polygon (represented by an array of two
		 * dimensional coordinates) from all other segments
		 *
		 * @param {Array} points
		 */
		const subtraction_path = _pointsToPath(points)
		const actions = [];

		for(let segment_id in _segmentation[_currentPage].segments){
			let segment = _segmentation[_currentPage].segments[segment_id];
			let segment_path = _pointsToPath(segment.coords.points)
			if(_pathContains(subtraction_path, segment.coords.points)){
				actions.push(new ActionRemoveSegment(segment, _editor, _textViewer, _segmentation, _currentPage,
					this, _selector, true));
			}else if(subtraction_path.intersects(segment_path)) {
				let clipped_path = segment_path.subtract(subtraction_path);

				if (clipped_path) {
					/* Check if a subtraction operation splits an existing segment into at least two new paths and creates
                    * new segments accordingly */
					if (clipped_path instanceof paper.CompoundPath) {
						actions.push(new ActionRemoveSegment(segment, _editor, _textViewer, _segmentation, _currentPage,
							this, _selector, true));

						for (let i = clipped_path.children.length - 1; i >= 0; i--) {
							let new_region = clipped_path.children[i];
							let newID = "c" + _newPolygonCounter;
							_newPolygonCounter++;

							actions.push(new ActionAddSegment(newID, _pathToPoints(new_region), segment.type, _editor,
								_segmentation, _currentPage, this))
						}
					} else {
						let clipped_points = _pathToPoints(clipped_path);
						actions.push(new ActionTransformSegment(segment.id, clipped_points, _editor, _segmentation, _currentPage, this));

					}
				}
			}
		}

		if(actions){
			let subtractActions = new ActionMultiple(actions);
			_actionController.addAndExecuteAction(subtractActions, _currentPage);
		}

		_gui.unselectAllToolBarButtons();
	}

	this.subtractTextLines = function(points){
		/**
		 * Subtracts the intersected area of a subtraction rectangle or polygon (represented by an array of two
		 * dimensional coordinates) from all other text lines in the currently selected text region
		 *
		 * @param {Array} points
		 */
		const subtraction_path = _pointsToPath(points)
		const actions = [];

		const selected = _selector.getSelectedSegments();
		if(selected.length > 0 &&
			(_selector.selectedType === ElementType.SEGMENT && this.isIDTextRegion(selected[0])) ||
			(_selector.selectedType === ElementType.TEXTLINE && this.isIDTextRegion(this.textlineRegister[selected[0]]))) {
			this.endEditing();
			_tempID = _selector.selectedType === ElementType.SEGMENT ? selected[0] : this.textlineRegister[selected[0]];
			if(this.isIDTextRegion(_tempID)){
				const _textSegment = _segmentation[_currentPage].segments[_tempID];
				if(_textSegment.textlines){
					for(let key of Object.keys(_textSegment.textlines)){
						let textline = _textSegment.textlines[key];
						let textline_path = _pointsToPath(textline.coords.points);

						if(_pathContains(subtraction_path, textline.coords.points)){
							actions.push(new ActionRemoveTextLine(textline, _editor, _textViewer, _segmentation, _currentPage,
								this, _selector, true));
						}else if(subtraction_path.intersects(textline_path)){
							let clipped_path = textline_path.subtract(subtraction_path);

							if(clipped_path){
								/* Check if a subtraction operation splits an existing text line into at least two new
                                * paths and creates new text lines accordingly */
								if (clipped_path instanceof paper.CompoundPath) {
									actions.push(new ActionRemoveTextLine(textline, _editor, _textViewer, _segmentation, _currentPage,
										this, _selector, true));

									for (let i = clipped_path.children.length - 1; i >= 0; i--) {
										let new_region = clipped_path.children[i];
										let newID = "c" + _newPolygonCounter;
										_newPolygonCounter++;
										actions.push(new ActionAddTextLine(newID, _textSegment.id,_pathToPoints(new_region), {}, _editor,
											_textViewer, _segmentation, _currentPage, this))
									}
								}else{
									let clipped_points = _pathToPoints(clipped_path);
									actions.push(new ActionTransformTextLine(textline.id, clipped_points, _editor, _textViewer, _segmentation, _currentPage, this));
								}
							}
						}
					}
				}
			}
			if(actions){
				let subtractActions = new ActionMultiple(actions);
				_actionController.addAndExecuteAction(subtractActions, _currentPage);
			}
		}else{
			_gui.displayWarning('Warning: Can only subtract TextLines if a TextRegion has been selected before hand.');
		}
	}

	function _pathContains(path, target_points){
		/**
		 * Checks whether the target path is fully contained by a path
		 *
		 * @param {paper.Path} path
		 * @param {Array} target_path
		 */
		for (let i = 0; i < target_points.length; i += 1) {
			let point = new paper.Point(target_points[i].x, target_points[i].y);
			if(!path.contains(point)){
				console.log("Doesn't contain point");
				return false;
			}
		}

		return true;
	}

	function _pointsToPath(points) {
		/**
		 * Converts an array of two dimensional coordinates to a closed paper.Path
		 *
		 * @param {Array} points
		 */
		let path = new paper.Path()
		for (let i = 0; i < points.length; i += 1) {
			let point = new paper.Point(points[i].x, points[i].y);
			path.add(point);
		}
		path.closed = true;

		return path
	}

	function _pathToPoints(path){
		/**
		 * Extracts all points of a closed paper.Path to an Array of two dimensional coordinates
		 *
		 * @param {paper.Path} path
		 */
		const points = [];
		for (let pointItr = 0, pointMax = path.segments.length; pointItr < pointMax; pointItr++) {
			const point = path.segments[pointItr].point;
			let coords = {x: point.x, y: point.y}
			points.push(coords);
		}
		return points;
	}

	this.createCut = function () {
		this.endEditing();
		_editor.startCreateLine();
		_gui.selectToolBarButton(ElementType.CUT, true);
	}

	this.fixSelected = function () {
		if (_selector.selectedType === ElementType.SEGMENT) {
			const actions = [];
			const selected = _selector.getSelectedSegments();
			const selectType = _selector.getSelectedPolygonType();
			for (let i = 0, selectedlength = selected.length; i < selectedlength; i++) {
				if (selectType === ElementType.AREA) {
				} else if (selectType === ElementType.SEGMENT) {
					let wasFixed = $.inArray(selected[i], _fixedGeometry[_currentPage].segments) > -1;
					actions.push(new ActionFixSegment(selected[i], this, !wasFixed));
				} else if (selectType === ElementType.CUT) {
				}
			}
			let multiFix = new ActionMultiple(actions);
			_actionController.addAndExecuteAction(multiFix, _currentPage);
			selected.forEach(s => _selector.select(s));
		}
	}

	this.moveSelectedPoints = function () {
		const selected = _selector.getSelectedSegments();
		const selectType = _selector.getSelectedPolygonType();
		let points = _selector.getSelectedPoints();

		if (points && points.length > 0 && selected.length === 1
			&& (selectType === ElementType.SEGMENT || selectType === ElementType.TEXTLINE)) {
			_editor.startMovePolygonPoints(selected[0], selectType, points);
		}
	}

	this.endEditing = function () {
		_editor.endEditing();
		this.displayContours(false);
		_gui.unselectAllToolBarButtons();
		_gui.closeTextLineContent();
	}

	this.deleteSelected = function () {
		const selected = _selector.getSelectedSegments();
		const points = _selector.getSelectedPoints();
		const selectType = _selector.getSelectedPolygonType();

		if (selected.length === 1 && points.length > 0) {
			// Points inside of a polygon is selected => Delete points
			if(selectType === ElementType.SEGMENT || selectType === ElementType.TEXTLINE){
				const segments = (selectType === ElementType.SEGMENT) ?
					_segmentation[_currentPage].segments[selected[0]].coords.points:
					_segmentation[_currentPage].segments[this.textlineRegister[selected[0]]].textlines[selected[0]].coords.points;
				let filteredSegments = segments;

				points.forEach(p => { filteredSegments = filteredSegments.filter(s => !(s.x === p.x && s.y === p.y))});
				if(filteredSegments && filteredSegments.length > 0){
					if(selectType === ElementType.SEGMENT)
						_actionController.addAndExecuteAction(new ActionTransformSegment(selected[0], filteredSegments, _editor, _segmentation, _currentPage, this), _currentPage);
					else
						_actionController.addAndExecuteAction(new ActionTransformTextLine(selected[0], filteredSegments, _editor, _textViewer, _segmentation, _currentPage, this), _currentPage);
				} else {
					if(selectType === ElementType.SEGMENT){
						let segment = _segmentation[_currentPage].segments[selected[0]];
						_actionController.addAndExecuteAction(new ActionRemoveSegment(segment, _editor, _textViewer, _segmentation, _currentPage, this, _selector, true), _currentPage);
					} else {
						let segment = _segmentation[_currentPage].segments[this.textlineRegister[selected[0]]].textlines[selected[0]];
						_actionController.addAndExecuteAction(new ActionRemoveTextLine(segment, _editor, _textViewer, _segmentation, _currentPage, this, _selector, true), _currentPage);
					}

				}
			}
		} else {
			//Polygon is selected => Delete polygon
			const actions = [];
			for (let i = 0, selectedlength = selected.length; i < selectedlength; i++) {
				if (selectType === ElementType.AREA) {
					actions.push(new ActionRemoveRegionArea(this._getRegionByID(selected[i]), _editor, _settings, this));
				} else if (selectType === ElementType.SEGMENT && (_mode === Mode.SEGMENT || _mode === Mode.EDIT)) {
					let segment = _segmentation[_currentPage].segments[selected[i]];
					actions.push(new ActionRemoveSegment(segment, _editor, _textViewer, _segmentation, _currentPage, this, _selector, (i === selected.length-1 || i === 0)));
				} else if (selectType === ElementType.CUT) {
					let cut = _fixedGeometry[_currentPage].cuts[selected[i]];
					actions.push(new ActionRemoveCut(cut, _editor, _fixedGeometry, _currentPage));
				} else if (selectType === ElementType.TEXTLINE) {
					let segment = _segmentation[_currentPage].segments[this.textlineRegister[selected[i]]].textlines[selected[i]];
					actions.push(new ActionRemoveTextLine(segment, _editor, _textViewer, _segmentation, _currentPage, this, _selector, (i === selected.length-1 || i === 0)));
				}
			}
			let multidelete = new ActionMultiple(actions);
			_actionController.addAndExecuteAction(multidelete, _currentPage);
		}
	}

	this.mergeSelected = function () {
		const selected = _selector.getSelectedSegments();
		const selectType = _selector.getSelectedPolygonType();

		if(selected.length > 1 && (selectType === ElementType.SEGMENT || selectType === ElementType.TEXTLINE)){
			const actions = [];
			const segments = [];
			let parent = null;
			for (let i = 0, selectedlength = selected.length; i < selectedlength; i++) {
				let segment = null;
				if (selectType === ElementType.SEGMENT) {
					segment = _segmentation[_currentPage].segments[selected[i]];
				} else {
					segment = _segmentation[_currentPage].segments[this.textlineRegister[selected[i]]].textlines[selected[i]];
				}
				//filter special case image (do not merge images)
				if (segment.type !== 'ImageRegion') {
					segments.push(segment);
					if(_mode === Mode.SEGMENT || _mode === Mode.EDIT){
						actions.push(new ActionRemoveSegment(segment, _editor, _textViewer, _segmentation, _currentPage, this, _selector));
					} else if(_mode === Mode.LINES){
						parent = !parent ? this.textlineRegister[segment.id] : parent;
						actions.push(new ActionRemoveTextLine(segment, _editor, _textViewer, _segmentation, _currentPage, this, _selector));
					}
				}
			}
			if (segments.length > 1) {
				_communicator.mergeSegments(segments).done((data) => {
					const mergedSegment = data;
					if(mergedSegment.coords.points.length > 1){
						if(_mode === Mode.SEGMENT || _mode === Mode.EDIT){
							actions.push(new ActionAddSegment(mergedSegment.id, mergedSegment.coords.points, mergedSegment.type,
								_editor, _segmentation, _currentPage, this));
						}else if(_mode === Mode.LINES){
							actions.push(new ActionAddTextLine(mergedSegment.id, parent, mergedSegment.coords.points,
								{}, _editor, _textViewer, _segmentation, _currentPage, this));
						}

						let mergeAction = new ActionMultiple(actions);
						_actionController.addAndExecuteAction(mergeAction, _currentPage);
						this.selectElement(mergedSegment.id);
						this.openContextMenu(true);
					} else {
						_gui.displayWarning("Combination of segments resulted in a segment with to few points. Segment will be ignored.");
					}
				});
			}
		} else if(selectType === ElementType.CONTOUR){
			const contours = selected.map(id => _contours[_currentPage][id]);
			const contourAccuracy = 50;
			const width = _book.pages[_currentPage].width;
			const height = _book.pages[_currentPage].height;
			_communicator.combineContours(contours,width,height,contourAccuracy).done((segment) => {
				if(segment.coords.points.length > 0){
					// Check if in Mode Lines (create TextLine or Region)
					if(_mode === Mode.LINES && _tempID) {
						_actionController.addAndExecuteAction(
							new ActionAddTextLine(segment.id, _tempID, segment.coords.points, {}, _editor, _textViewer, _segmentation, _currentPage, this),
							_currentPage);
					}else{
						_actionController.addAndExecuteAction(
							new ActionAddSegment(segment.id, segment.coords.points, segment.type, _editor, _segmentation, _currentPage, this),
							_currentPage);
					}

					_selector.unSelect();
					this.openContextMenu(true);
				} else {
					_gui.displayWarning("Combination of contours resulted in a segment with to few points. Segment will be ignored.");
				}
			});
		}
	}

	this.changeTypeSelected = function (newType) {
		const selected = _selector.getSelectedSegments();
		const selectType = _selector.getSelectedPolygonType();
		const selectedlength = selected.length;
		if (selectType === ElementType.AREA || selectType === ElementType.SEGMENT){
			if (selectedlength || selectedlength > 0) {
				const actions = [];
				for (let i = 0; i < selectedlength; i++) {
					if (selectType === ElementType.AREA) {
						const regionPolygon = this._getRegionByID(selected[i]);
						actions.push(new ActionChangeTypeRegionArea(regionPolygon, newType, _editor, _settings, _currentPage, this));

						this.hideRegionAreas(newType, false);
					} else if (selectType === ElementType.SEGMENT) {
						actions.push(new ActionChangeTypeSegment(selected[i], newType, _editor, _textViewer, this, _selector, _segmentation, _currentPage, false));
					}
				}
				const multiChange = new ActionMultiple(actions);
				_actionController.addAndExecuteAction(multiChange, _currentPage);
			}
		}
	}

	this.createRegionAreaBorder = function () {
		this.endEditing();
		_editor.startCreateBorder(ElementType.AREA);
		_gui.selectToolBarButton('regionBorder', true);
	}

	this.callbackNewArea = function (regionpoints, regiontype) {
		const newID = "c" + _newPolygonCounter;
		_newPolygonCounter++;
		let type;
		if (!regiontype) {
			type = _presentRegions[0];
			if (!type) {
				type = "other";
			}
		} else {
			type = regiontype;
		}

		if(regionpoints && this._countUniquePoints(regionpoints) > 3){
			const actionAdd = new ActionAddRegionArea(newID, regionpoints, type,
				_editor, _settings);

			_actionController.addAndExecuteAction(actionAdd, _currentPage);
			if (!regiontype) {
				this.openContextMenu(false, newID);
			}
		} else {
			_gui.displayWarning("Regions need at least three unique points. Region will be ignored.")
		}
		_gui.unselectAllToolBarButtons();
	}

	this.callbackNewRoI = function (regionpoints) {
		if(regionpoints && regionpoints.length > 2 && this._countUniquePoints(regionpoints) > 1){
			let left = 1;
			let right = 0;
			let top = 1;
			let down = 0;

			$.each(regionpoints, function (index, point) {
				if (point.x < left)
					left = point.x;
				if (point.x > right)
					right = point.x;
				if (point.y < top)
					top = point.y;
				if (point.y > down)
					down = point.y;
			});

			const actions = [];

			//Create 'inverted' ignore rectangle
			actions.push(new ActionAddRegionArea("c" + _newPolygonCounter, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: top }, { x: 0, y: top }], 'ignore',
				_editor, _settings));
			_newPolygonCounter++;

			actions.push(new ActionAddRegionArea("created" + _newPolygonCounter, [{ x: 0, y: 0 }, { x: left, y: 0 }, { x: left, y: 1 }, { x: 0, y: 1 }], 'ignore',
				_editor, _settings));
			_newPolygonCounter++;

			actions.push(new ActionAddRegionArea("created" + _newPolygonCounter, [{ x: 0, y: down }, { x: 1, y: down }, { x: 1, y: 1 }, { x: 0, y: 1 }], 'ignore',
				_editor, _settings));
			_newPolygonCounter++;

			actions.push(new ActionAddRegionArea("created" + _newPolygonCounter, [{ x: right, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: right, y: 1 }], 'ignore',
				_editor, _settings));
			_newPolygonCounter++;

			_actionController.addAndExecuteAction(new ActionMultiple(actions), _currentPage);
		} else {
			_gui.displayWarning("Region Areas need at least three unique points. Area will be ignored.")
		}
		_gui.unselectAllToolBarButtons();
	}

	this.callbackNewSegment = function (segmentpoints) {
		const newID = "c" + _newPolygonCounter;
		_newPolygonCounter++;
		let type = _presentRegions[0];
		if (!type) {
			type = "other";
		}
		if(segmentpoints && this._countUniquePoints(segmentpoints) > 3){
			const actionAdd = new ActionAddSegment(newID, segmentpoints, type,
				_editor, _segmentation, _currentPage, this);

			_actionController.addAndExecuteAction(actionAdd, _currentPage);
			this.openContextMenu(false, newID);
		} else {
			_gui.displayWarning("Region need at least three unique points. Region will be ignored.")
		}
		_gui.unselectAllToolBarButtons();
	}

	this.callbackNewTextLine = function (segmentpoints) {
		const newID = "c" + _newPolygonCounter;
		_newPolygonCounter++;
		if(segmentpoints && this._countUniquePoints(segmentpoints) > 3){
			const actionAdd = new ActionAddTextLine(newID,_tempID, segmentpoints, {},
				_editor, _textViewer, _segmentation, _currentPage, this);

			_actionController.addAndExecuteAction(actionAdd, _currentPage);
			this.openContextMenu(false, newID);
		} else {
			_gui.displayWarning("Textlines need at least three unique points. Textline will be ignored.")
		}
		_gui.unselectAllToolBarButtons();
	}

	this.callbackNewCut = function (segmentpoints) {
		const newID = "c" + _newPolygonCounter;
		_newPolygonCounter++;

		const actionAdd = new ActionAddCut(newID, segmentpoints,
			_editor, _fixedGeometry, _currentPage);

		_actionController.addAndExecuteAction(actionAdd, _currentPage);
		_gui.unselectAllToolBarButtons();
	}

	this._countUniquePoints = function(points){
		return (new Set(points.map(s => JSON.stringify(s)))).size;
	}

	this.movePolygonPoints = function (id, segmentPoints, type=this.getIDType(id)) {
		if(type === ElementType.SEGMENT || type === ElementType.TEXTLINE){
			this.transformSegment(id, segmentPoints, type);
			_selector.unSelect();
			_selector.select(id,segmentPoints);
		}
	}

	this.transformSegment = function (id, segmentPoints, type=this.getIDType(id)) {
		let action;
		switch(type){
			case ElementType.SEGMENT:
				action = new ActionTransformSegment(id, segmentPoints, _editor, _segmentation, _currentPage, this);
				break;
			case ElementType.TEXTLINE:
				action =  new ActionTransformTextLine(id, segmentPoints, _editor, _textViewer, _segmentation, _currentPage, this);
				break;
			default:
		}
		if(action) {
			_actionController.addAndExecuteAction(action, _currentPage);
		}
	}

	this.scaleSelectedRegionArea = function () {
		_editor.endEditing();
		const selectType = _selector.getSelectedPolygonType();
		const selected = _selector.getSelectedSegments();

		if (selectType === ElementType.AREA && selected.length === 1)
			_editor.startScalePolygon(selected[0], ElementType.AREA);
	}

	this.transformRegionArea = function (regionID, areaPolygon) {
		const polygonType = this.getIDType(regionID);
		if (polygonType === ElementType.AREA) {
			let regionType = this._getRegionByID(regionID).type;
			let actionTransformRegion = new ActionTransformRegionArea(regionID, areaPolygon, regionType, _editor, _settings, _currentPage, this);
			_actionController.addAndExecuteAction(actionTransformRegion, _currentPage);
			this.hideRegionAreas(regionType, false);
			_selector.select(regionID);
		}
	}

	this.changeRegionType = function (id, type) {
		const polygonType = this.getIDType(id);
		if (polygonType === ElementType.AREA) {
			const regionPolygon = this._getRegionByID(id);
			if (regionPolygon.type !== type) {
				let actionChangeType = new ActionChangeTypeRegionArea(regionPolygon, type, _editor, _settings, _currentPage, this);
				_actionController.addAndExecuteAction(actionChangeType, _currentPage);
			}
			this.hideRegionAreas(type, false);
		} else if (polygonType === ElementType.SEGMENT) {
			if (_segmentation[_currentPage].segments[id].type !== type) {
				const actionChangeType = new ActionChangeTypeSegment(id, type, _editor, _textViewer, this, _selector, _segmentation, _currentPage, false);
				_actionController.addAndExecuteAction(actionChangeType, _currentPage);
			}
		}
	}

	this.openRegionSettings = function (regionType) {
		if(regionType){
			let region = _settings.regions[regionType];
			if (!region)
				region = _settings.regions['paragraph']; // If no settings exist, take the ones of paragraph
			if (!_colors.hasColor(regionType))
				_colors.assignAvailableColor(regionType);
			const colorID = _colors.getColorID(regionType);

			_gui.openRegionSettings(regionType, region.minSize, region.maxOccurances, colorID);
		}else{
			_gui.openRegionCreate();
		}
	}

	this.setRegionColor = function (regionType, colorID) {
		_colors.setColor(regionType, colorID);
		_gui.updateAvailableColors();

		const pageSegments = _segmentation[_currentPage].segments;
		Object.keys(pageSegments).forEach((key) => {
				let segment = pageSegments[key];
				if (segment.type === regionType) {
					_editor.updateSegment(segment);
				}
		});

		const region = _settings.regions[regionType];
		// Iterate over all Polygons in Region
		Object.keys(region.areas).forEach((polygonKey) => {
			let polygon = region.areas[polygonKey];
			if (polygon.type === regionType) {
				_editor.updateSegment(polygon);
			}
		});
		_gui.updateRegionLegendColors(_presentRegions);
	}

	/**
	 * Add all currently selected segments that can be added to the reading order (global or local)
	 * to the reading order.
	 */
	this.addSelectedToReadingOrder = function(){
		const selected = _editor.getSortedReadingOrder(_selector.getSelectedSegments());
		const selectType = _selector.getSelectedPolygonType();

		let alreadyInReadingOrder = false;

		const actions = [];
		for (let i = 0, selectedlength = selected.length; i < selectedlength; i++) {
			const id = selected[i];

			if (selectType === ElementType.SEGMENT && (_mode === Mode.SEGMENT || _mode === Mode.EDIT)) {
				let segment = _segmentation[_currentPage].segments[id];
				alreadyInReadingOrder = (alreadyInReadingOrder || this._readingOrderContains(id));

				if (!alreadyInReadingOrder && segment.type !== 'ImageRegion'){
					actions.push(new ActionAddToReadingOrder(segment, _currentPage, _segmentation, this));
				}
			} else if (selectType === ElementType.TEXTLINE && _mode === Mode.LINES) {
				const parentID = this.textlineRegister[id];
				alreadyInReadingOrder = (alreadyInReadingOrder || this._readingOrderContains(id));
				if (!alreadyInReadingOrder){
					actions.push(new ActionAddTextLineToReadingOrder(id,parentID, _currentPage, _segmentation, this, _selector));
				}
			}
		}
		if(actions.length > 0){
			_actionController.addAndExecuteAction(new ActionMultiple(actions), _currentPage);
		} else if (alreadyInReadingOrder){
			_gui.displayWarning("The selected element is already in the reading order.");
		} else {
			_gui.displayWarning("You need to select an element to add to the reading order.");
		}
	}

	this.autoGenerateReadingOrder = function (_page = _currentPage) {
		this.endEditReadingOrder();
		let readingOrder = [];
		let polygons = [];
		const pageSegments = _segmentation[_page].segments;

		// Iterate over Segment-"Map" (Object in JS)
		Object.keys(pageSegments).forEach((key) => {
			let segment = pageSegments[key];
			if (segment.type !== 'ImageRegion') {
				readingOrder.push(segment.id);
				polygons.push(segment.coords.points);
			}
		});
		readingOrder = _editor.getSortedReadingOrder(readingOrder, polygons);
		_actionController.addAndExecuteAction(new ActionChangeReadingOrder(_segmentation[_page].readingOrder, readingOrder, this, _segmentation, _page), _page);
	}

	/**
	 * Toggle if the reading order can be edited by clicking on segments.
	 * (Left click will add to the reading order and right click will end the edit)
	 */
	this.toggleEditReadingOrder = function() {
		_editReadingOrder = !_editReadingOrder;
		_gui.selectToolBarButton('editReadingOrder', _editReadingOrder);
	}

	/**
	 * End edit reading order
	 */
	this.endEditReadingOrder = function(){
		_editReadingOrder = false;
		_gui.selectToolBarButton('editReadingOrder', _editReadingOrder);
	}

	/**
	 * Save the current reading order via an action state
	 */
	this.saveReadingOrder = function () {
		const tempReadingOrder = JSON.parse(JSON.stringify(_gui.getReadingOrder()));
		if(_mode === Mode.LINES){
			const type = _selector.getSelectedPolygonType();
			const segmentID = (type === ElementType.SEGMENT) ? _selector.getSelectedSegments()[0]
															: this.textlineRegister[_selector.getSelectedSegments()[0]];
			if(segmentID !== undefined && segmentID !== null){
				if(tempReadingOrder !== _segmentation[_currentPage].segments[segmentID].readingOrder){
					const action = new ActionChangeTextLineReadingOrder(_segmentation[_currentPage].segments[segmentID].readingOrder,
														tempReadingOrder, segmentID, this, _segmentation, _currentPage, _selector);
					_actionController.addAndExecuteAction(action, _currentPage);
				}
			}
		}else{
			if(tempReadingOrder !== _segmentation[_currentPage].readingOrder){
				const action = new ActionChangeReadingOrder( _segmentation[_currentPage].readingOrder,
													tempReadingOrder, this, _segmentation, _currentPage);
				_actionController.addAndExecuteAction(action, _currentPage);
			}
		}
	}

	/**
	 * Delete the current reading order completelly
	 */
	this.deleteReadingOrder = function () {
		if(_mode === Mode.LINES) {
			// Delete local text line reading order
			const type = _selector.getSelectedPolygonType();
			const segmentID = (type === ElementType.SEGMENT) ? _selector.getSelectedSegments()[0]
															: this.textlineRegister[_selector.getSelectedSegments()[0]];
			if(segmentID !== undefined && segmentID !== null){
				const currentReadingOrder = _segmentation[_currentPage].segments[segmentID].readingOrder;
				if(currentReadingOrder && currentReadingOrder.length > 0){
					const action = new ActionChangeTextLineReadingOrder(currentReadingOrder, [],
																		segmentID, this,
																		_segmentation, _currentPage, _selector);
					_actionController.addAndExecuteAction(action, _currentPage);
				}
			}
		} else {
			// Delete global page reading order
			const currentReadingOrder = _segmentation[_currentPage].readingOrder;
			if(currentReadingOrder && currentReadingOrder.length > 0){
				const action = new ActionChangeReadingOrder(currentReadingOrder, [], this, _segmentation, _currentPage);
				_actionController.addAndExecuteAction(action, _currentPage);
			}
		}
	}

	/**
	 * Display/Hide the global reading order of a page (SEGMENT Mode) or
	 * the local text line reading order of a segment (TEXTLINE Mode).
	 */
	this.displayReadingOrder = function (doDisplay=true) {
		if(doDisplay){
			let readingOrder = []; // temp reading order either pointing to a global or local reading order
			if(_segmentation[_currentPage] !== null){
				if (_mode === Mode.SEGMENT || _mode === Mode.EDIT) {
					// Display the normal reading order
					readingOrder = (_segmentation[_currentPage].readingOrder || [] );
					_gui.setReadingOrder(readingOrder, _segmentation[_currentPage].segments);

				} else if(_mode === Mode.LINES) {
					// Get TextRegion segment or parent of Textline, depending on selection
					const selected = _selector.getSelectedSegments();
					if(selected.length > 0){
						const selectedType = _selector.getSelectedPolygonType();
						// Retrieve TextRegion ID
						let segmentID;
						if(selectedType === ElementType.SEGMENT){
							// Get segmentID of a selected TextRegion (paragraph etc.)
							segmentID = selected.filter(id => !_segmentation[_currentPage].segments[id].type.includes("Region"))[0];

						} else if(selectedType === ElementType.TEXTLINE){
							const parents = selected.map((id) => this.textlineRegister[id]).sort();
							// Create counter object for parents accurences
							const parents_counter = {};
							parents.forEach(p => {parents_counter[p] = (parents_counter[p] || 0) + 1});
							// Sort and retrieve most represented/dominant parent
							[segmentID,_] = [...Object.entries(parents_counter)].sort((a, b) => b[1] - a[1])[0];
						}
						// Undefined segmentID points to non TextRegion region
						if(segmentID) {
							const segment = _segmentation[_currentPage].segments[segmentID];
							readingOrder = (segment.readingOrder || []);
							_gui.setReadingOrder(readingOrder, segment.textlines);
						} else {
							_gui.setReadingOrder(readingOrder, []);
						}
					} else {
						_gui.setReadingOrder([], {}, warning="Please select a segment");
					}
				} else {
					_gui.setReadingOrder([], {});
				}
			}
			_editor.displayReadingOrder(readingOrder);
		}else{
			_editor.hideReadingOrder();
		}
		_gui.displayReadingOrder(doDisplay);
	}

	this.forceUpdateReadingOrder = function (forceDisplay=false) {
		let _readingOrderDisplaySetting = $("#settings-hint-reading-order").find('input').prop('checked');
		_gui.updateRegionLegendColors(_presentRegions);
		_textViewer.orderTextlines(_selector.getSelectOrder(ElementType.TEXTLINE));
		if (forceDisplay && _readingOrderDisplaySetting){
			this.displayReadingOrder(true);
			_gui.openReadingOrderSettings();
		}else{
			this.displayReadingOrder(_gui.isReadingOrderActive());
		}
	}

	/**
	 * Remove an element by its id from the reading order.
	 */
	this.removeFromReadingOrder = function (id) {
		switch(_mode){
			case Mode.SEGMENT:
			case Mode.EDIT:
				_actionController.addAndExecuteAction(new ActionRemoveFromReadingOrder(id, _currentPage, _segmentation, this), _currentPage);
				break;
			case Mode.LINES:
				_actionController.addAndExecuteAction(new ActionRemoveTextLineFromReadingOrder(id, this.textlineRegister[id], _currentPage, _segmentation, this, _selector), _currentPage);
				break;
		}
	}

	/**
	 * Toggles move mode
	 */
	this.move = function(){
		if(!_move){
			_move = true;
			_gui.selectToolBarButton("move", _move);
			_editor.startMove();
		}else{
			_move = false;
			_gui.selectToolBarButton("move", _move);
			_editor.endMove();
		}
	}

	/**
	 * End mode mode
	 */
	this.endMove = function(){
		_move = false;
		_gui.selectToolBarButton('move', _move);
	}

	/**
	 * Update the textline with its content
	 */
	this.updateTextLine = function(id) {
		if(this.getIDType(id) === ElementType.TEXTLINE){
			const textline = _segmentation[_currentPage].segments[this.textlineRegister[id]].textlines[id];
			// Check if the update request came for a deleted textline
			if(textline){
				const hasGT = 0 in textline.text;
				if(hasGT){
					textline.type = "TextLine_gt";
				} else {
					textline.type = "TextLine";
				}
				_editor.updateSegment(textline);

				_gui.updateTextLine(id);

				_textViewer.updateTextline(textline);
			}
		}
	}
	/**
	 * Display the  text viewer
	 */
	this.displayTextViewer = function(doDisplay=true){
		_textViewer.display(doDisplay);
		const selected = _selector.getSelectedSegments();
		if(doDisplay){
			_gui.closeTextLineContent();
			if(selected){
				_textViewer.setFocus(selected[0]);
			}
			_textViewer.displayZoom();
		} else {
			if(selected && this.getIDType(selected[0]) === ElementType.TEXTLINE){
				const id = selected[0];
				const parentID = this.textlineRegister[id];
				_gui.openTextLineContent(_segmentation[_currentPage].segments[parentID].textlines[id]);
			}
			_gui.updateZoom();
		}
	}

	this.changeImageMode = function (imageMode) {
		_settings.imageSegType = imageMode;
	}

	this.changeImageCombine = function (doCombine) {
		_settings.combine = doCombine;
	}

	this.applyGrid = function () {
		_editor.addGrid();
	}

	this.removeGrid = function () {
		_editor.removeGrid();
	}

	this._readingOrderContains = function (id,parentID=this.textlineRegister[id],type=this.getIDType(id)) {
		const readingOrder = (type === ElementType.SEGMENT) ?
								_segmentation[_currentPage].readingOrder :
								_segmentation[_currentPage].segments[parentID].readingOrder;

		return readingOrder && readingOrder.includes(id);
	}
	// Display
	this.selectElement = function (sectionID, hitTest, idType=this.getIDType(sectionID)) {
		if (_editReadingOrder && idType === ElementType.SEGMENT) {

			const segment = _segmentation[_currentPage].segments[sectionID];
			if (!this._readingOrderContains(sectionID)) {
				_actionController.addAndExecuteAction(new ActionAddToReadingOrder(segment, _currentPage, _segmentation, this), _currentPage);
			}
		} else {
			let points;
			if (hitTest && hitTest.type === ElementType.SEGMENT) {
				const nearestPoint = hitTest.segment.point;
				points = [_editor._convertCanvasToGlobal(nearestPoint.x, nearestPoint.y)];
				_selector.select(sectionID, points);
			} else {
				if(this.getMode() === Mode.TEXT && _pastId && _pastId !== sectionID) {
					this.saveLineById(_pastId);
				}
				_pastId = sectionID;
				_selector.select(sectionID, null, idType);
			}

			this.closeContextMenu();
		}
	}
	this.highlightSegment = function (sectionID, doHighlight = true) {
		if(doHighlight){
			if (!_editor.isEditing || _editor.requiresSegmentHighlighting) {
				if((_mode === Mode.SEGMENT || _mode === Mode.EDIT) ||
						(_mode === Mode.LINES &&
							(this.getIDType(sectionID) === ElementType.TEXTLINE || _selector.getSelectedSegments().length === 0))){
					_editor.highlightSegment(sectionID, doHighlight);
					_gui.highlightSegment(sectionID, doHighlight);
					_hoveredElement = sectionID;
				}
			}
		}else{
			_editor.highlightSegment(sectionID, doHighlight);
			_gui.highlightSegment(sectionID, doHighlight);
			_hoveredElement = null;
		}
	}
	this.getHoveredElement = function(){
		if(_mode === Mode.SEGMENT || _mode === Mode.EDIT){
			return _segmentation[_currentPage].segments[_hoveredElement];
		}else if(_mode === Mode.LINES){
			const parent = this.textlineRegister[_hoveredElement];
			if(parent)
				return _segmentation[_currentPage].segments[parent].textlines[_hoveredElement];
		}
	}
	this.hideAllSegments = function (doHide){
		_editor._overlays.segments.children.forEach(function (item) {
			item.visible = !doHide;
		})
	}
	this.hideAllLines = function (doHide){
		_editor._overlays.lines.children.forEach(function (item) {
			if(item.elementID != null && !item.elementID.endsWith("_baseline"))
				item.visible = !doHide;
		})
	}
	this.hideAllBaselines = function (doHide){
		_editor._overlays.lines.children.forEach(function (item) {
			if(item.elementID != null && item.elementID.endsWith("_baseline"))
				item.visible = !doHide;
		})
	}
	this.hideAllRegionAreas = function (doHide) {
		// Iterate over Regions-"Map" (Object in JS)
		Object.keys(_settings.regions).forEach((key) => {
			const region = _settings.regions[key];
			if (region.type !== 'ignore') {
				// Iterate over all Polygons in Region
				Object.keys(region.areas).forEach((polygonKey) => {
					let polygon = region.areas[polygonKey];
					_editor.hideSegment(polygon.id, doHide);
				});

				_visibleRegions[region.type] = !doHide;
			}
		});
	}
	this.hideRegionAreas = function (regionType, doHide) {
		_visibleRegions[regionType] = !doHide;

		const region = _settings.regions[regionType];
		// Iterate over all Polygons in Region
		Object.keys(region.areas).forEach((polygonKey) => {
			let area = region.areas[polygonKey];
			_editor.hideSegment(area.id, doHide);
		});
		_gui.forceUpdateRegionHide(_visibleRegions);
	}

	this.displayContours = function(display=true) {
		// Special case display contours in LINES mode
		// Save parent id to which the new contour/textline is to be added
		if(_mode === Mode.LINES && display){
			const selected = _selector.getSelectedSegments();
			const type = _selector.getSelectedPolygonType();

			if(selected.length > 0 &&
				(_selector.selectedType === ElementType.SEGMENT && this.isIDTextRegion(selected[0])) ||
				(_selector.selectedType === ElementType.TEXTLINE && this.isIDTextRegion(this.textlineRegister[selected[0]]))) {
				if(type === ElementType.SEGMENT){
					_tempID = selected[0];
				} else if (type === ElementType.TEXTLINE){
					const parents = selected.map((id) => this.textlineRegister[id]).sort();
					// Create counter object for parents accurences
					const parents_counter = {};
					parents.forEach(p => {parents_counter[p] = (parents_counter[p] || 0) + 1});
					// Sort and retrieve most represented/dominant parent
					const [dominant_parent,_] = [...Object.entries(parents_counter)].sort((a, b) => b[1] - a[1])[0];
					_tempID = dominant_parent;
				}
			} else {
				_gui.displayWarning('Warning: Can only add contour TextLines if a TextRegion has been selected before hand.');
				return null;
			}
		} else {
			_tempID = null;
		}

		// Display contours
		if(!display || _editor.mode === ViewerMode.CONTOUR){
			_editor.displayContours(false);
			_editor.mode = ViewerMode.POLYGON;
			_gui.selectToolBarButton('segmentContours',false);
		} else {
			_selector.unSelect();
			_gui.selectToolBarButton('segmentContours',true);
			if(!_contours[_currentPage]){
				this.showPreloader(true);
				_communicator.extractContours(_currentPage,_book.id).done((result) => {
					_contours[_currentPage] = result;
					this.showPreloader(false);
					_editor.setContours(_contours[_currentPage]);
					_editor.displayContours();
					_editor.mode = ViewerMode.CONTOUR;

					if(_mode === Mode.LINES && display){
						_editor.focusSegment(_tempID);
					}
				});
			} else {
				_editor.setContours(_contours[_currentPage]);
				_editor.displayContours();
				_editor.mode = ViewerMode.CONTOUR;

				if(_mode === Mode.LINES && display){
					_editor.focusSegment(_tempID);
				}
			}
		}
	}

	this.editLine = function(id){
		_gui.resetZoomTextline();
		_gui.resetTextlineDelta();
		if(this.getIDType(id) === ElementType.TEXTLINE){
			const textline = _segmentation[_currentPage].segments[this.textlineRegister[id]].textlines[id];
			if(!textline.minArea){
				_communicator.minAreaRect(textline).done((minArea) => {
					textline.minArea = minArea;
					_gui.openTextLineContent(textline);
				});
			} else {
				_gui.openTextLineContent(textline);
			}
		}
	}

	this.closeEditLine = function(){
		_gui.closeTextLineContent();
	}

	/**
	 * Save the currently open edit line
	 */
	this.saveLine = function(){
		let id;
		let textlinecontent;
		if(_textViewer.isOpen()){
			id = _textViewer.getFocusedId();
			textlinecontent = {text:_textViewer.getText(id)};
		} else {
			textlinecontent = _gui.getTextLineContent();
			id = textlinecontent.id;
		}

		if(id && this.getIDType(id) === ElementType.TEXTLINE){
			const content = textlinecontent.text;
			_actionController.addAndExecuteAction(new ActionChangeTextLineText(id, content, _textViewer, _gui, _segmentation, _currentPage, this), _currentPage);
		}
	}

	this.saveLineById = function(id) {
		let textlinecontent;
		if(_textViewer.isOpen()){
			textlinecontent = {text:_textViewer.getText(id)};
			if(id && this.getIDType(id) === ElementType.TEXTLINE){
				const content = textlinecontent.text;
				_actionController.addAndExecuteAction(new ActionChangeTextLineText(id, content, _textViewer, _gui, _segmentation, _currentPage, this), _currentPage);
			}
		}
	}

	this.saveLineOnDeselect = function() {
		let textlinecontent;
		if(_pastId){
			textlinecontent = {text:_textViewer.getText(_pastId)};
			if(_pastId){
				const content = textlinecontent.text;
				_actionController.addAndExecuteAction(new ActionChangeTextLineText(_pastId, content, _textViewer, _gui, _segmentation, _currentPage, this), _currentPage);
			}
			_pastId = null;
		}
	}

	this.discardGT = function(){
		let id;
		let textlinecontent;
		if(_textViewer.isOpen()){
			id = _textViewer.getFocusedId();
		} else {
			textlinecontent = _gui.getTextLineContent();
			id = textlinecontent.id;
		}

		if(id && this.getIDType(id) === ElementType.TEXTLINE){
			_actionController.addAndExecuteAction(new ActionDiscardGroundTruth(id, _textViewer, _gui, _segmentation, _currentPage, this), _currentPage);
		}
	}

	this.changeRegionSettings = function (regionType, minSize, maxOccurances) {
		let region = _settings.regions[regionType];
		//create Region if not present
		if (!region) {
			region = {};
			region.type = regionType;
			region.areas = {};
			_settings.regions[regionType] = region;
			_presentRegions.push(regionType);
			_gui.showUsedRegionLegends(_presentRegions);
		}
		region.minSize = minSize;
		region.maxOccurances = maxOccurances;
	}

	this.deleteRegionSettings = function (regionType) {
		if ($.inArray(regionType, _presentRegions) >= 0 && regionType !== 'ImageRegion' && regionType !== 'paragraph') {
			_actionController.addAndExecuteAction(new ActionRemoveRegionType(regionType, this, _editor, _settings, this), _currentPage);
		}
	}

	this.showPreloader = function (doShow) {
		if (doShow) {
			$('#preloader').removeClass('hide');
		} else {
			$('#preloader').addClass('hide');
		}
	}

	this.openContextMenu = function (doSelected, id) {
		const selected = _selector.getSelectedSegments();
		const selectType = _selector.getSelectedPolygonType();
		if (doSelected && selected && selected.length > 0 && (selectType === ElementType.AREA || selectType === ElementType.SEGMENT)) {
			_gui.openContextMenu(doSelected, id);
		} else {
			let polygonType = this.getIDType(id);
			if (polygonType === ElementType.AREA || polygonType === ElementType.SEGMENT) {
				_gui.openContextMenu(doSelected, id);
			}
		}
	}

	this.closeContextMenu = function () {
		_gui.closeContextMenu();
	}

	this.escape = function () {
		_selector.unSelect();
		this.closeContextMenu();
		this.endEditing();
		_gui.closeRegionSettings();
		_selector.unSelect();
		_pastId = null;
	}

	this.allowToLoadExistingSegmentation = function (allowLoadLocal) {
		_allowLoadLocal = allowLoadLocal;
	}

	this.allowToAutosegment = function (autoSegment) {
		_autoSegment = autoSegment;
	}

	this.isSegmentFixed = function (id) {
		if (_fixedGeometry[_currentPage] && _fixedGeometry[_currentPage].segments) {
			return ($.inArray(id, _fixedGeometry[_currentPage].segments) !== -1);
		} else {
			return false;
		}
	}

	this._getRegionByID = function (id) {
		let regionArea;
		Object.keys(_settings.regions).some((key) => {
			let region = _settings.regions[key];

			let area = region.areas[id];
			if (area) {
				regionArea = area;
				return true;
			}
		});
		return regionArea;
	}

	this.isIDTextRegion = function(id){
		//TODO: Refactor when support for custom text region classes is added (see https://github.com/OCR4all/LAREX/issues/176)
		const elementType = this.getIDType(id);
		let type = "Region";
		if(elementType === ElementType.SEGMENT){
			type = _segmentation[_currentPage].segments[id].type;
		}else if(elementType === ElementType.AREA){
			type = this._getRegionByID(id).type;
		}
		return (type === "TextRegion") ? true : (type !== "ignore" && !type.includes("Region"));
	}

	this.getIDType = function (id) {
		if(_segmentation && _segmentation[_currentPage]){
			let polygon = _segmentation[_currentPage].segments[id];
			if (polygon) return ElementType.SEGMENT;

			polygon = this._getRegionByID(id);
			if (polygon) return ElementType.AREA;

			if(_fixedGeometry[_currentPage] && _fixedGeometry[_currentPage].cuts){
				polygon = _fixedGeometry[_currentPage].cuts[id];
				if (polygon) return ElementType.CUT;
			}

			if (this.textlineRegister.hasOwnProperty(id)) return ElementType.TEXTLINE;
			}
		return false;
	}

	this.isTextRegion = function(type){
		//TODO: Refactor and use type / subtype just like in backend
		if(type === "TextRegion"){
			return true;
		}else if(!SegmentTypes.includes(type)){
			return true;
		}
		return false;
	}

	this.getCurrentSegmentation = function() {
		return _segmentation[_currentPage];
	}
	this.getCurrentSettings = function(){
		return _settings[_currentPage];
	}

	this.openBatchSegmentModal = function(){
		this.checkNextBatch();
		$("#batchSegmentModal").modal("open");
	}

	this.fillMetadataModal = function(){
		let metadata = _segmentation[_currentPage]["metadata"];

		const metadataCreator = $("#metadataCreator");
		const metadataComments = $("#metadataComments");
		const metadataExternalRef = $("#metadataExternalRef");
		const metadataCreated = $("#metadataCreated");
		const metadataLastModified = $("#metadataLastModified");

		(metadata["creator"] !== null) ? metadataCreator.val(metadata["creator"]) : metadataCreator.val("");
		(metadata["comments"] !== null) ? metadataComments.val(metadata["comments"]) : metadataComments.val("");
		(metadata["externalRef"] !== null) ? metadataExternalRef.val(metadata["externalRef"]) : metadataExternalRef.val("");
		(metadata["creationTime"] !== null) ?metadataCreated.val(new Date(metadata["creationTime"]).toLocaleString()) : metadataCreated.val("");
		(metadata["lastModificationTime"] !== null) ? metadataLastModified.val(new Date(metadata["lastModificationTime"]).toLocaleString()) : metadataLastModified.val("");

		metadataCreator.trigger('autoresize');
		metadataComments.trigger('autoresize');
		metadataExternalRef.trigger('autoresize');
		metadataCreated.trigger('autoresize');
		metadataLastModified.trigger('autoresize');
	}

	this.saveMetadata = function(){
		let metadata = _segmentation[_currentPage]["metadata"];

		if($("#metadataCreator").val() !== null){
			metadata["creator"] = $("#metadataCreator").val();
		}
		if($("#metadataComments").val() !== null){
			metadata["comments"] = $("#metadataComments").val();
		}
		if($("#metadataExternalRef").val() !== null){
			metadata["externalRef"] = $("#metadataExternalRef").val();
		}
	}

	this.openMetadataModal = function(){
		$("#metadataModal").modal("open");
	}

	this.checkNextBatch = function(){
		const selected_pages = $('.batchPageCheck:checkbox:checked').map(function(){
			return $(this).data("page");
		});
		const selected_modes = $('.modeSelect:checkbox:checked').toArray();
		let pagesSelected = false;
		let modesSelected = false;
		if(selected_pages.length) { pagesSelected = true; }
		if(selected_modes.length) { modesSelected = true; }
		if(pagesSelected && modesSelected) {
			$("#batchNext").removeClass("disabled");
		} else{
			$("#batchNext").addClass("disabled");
		}
	}
	this.toggleShortcutModal = function(){
		const $shortcutModal = $("#kb-shortcut-modal");
		const $tab = $("#kb-shortcut-modal-tabs")
		const _mode = this.getMode();

		if($shortcutModal.hasClass("open")){
			$shortcutModal.modal("close");
		}else{
			$shortcutModal.modal({
				ready: function(modal, trigger){
					$tab.tabs("select_tab", _mode);
				}
			})
			$shortcutModal.modal("open");
		}
	}

	this.resetSegmentVisibility = function(){
		_gui.resetSidebarActions();
		this.hideAllSegments(false);
		this.hideAllLines(false);
		this.hideAllBaselines(false);
	}

	this.toggleSegmentVisibility = function(){
		let state = !$("#toggleSegmentVisibility").prop("checked");
		$("#toggleSegmentVisibility").prop("checked", state);
		_gui.openSidebarCollapsible("actions");
		this.hideAllSegments(state);
	}

	this.rotatePolygon = function (angle, polygon, offset, centroid){
		for (const key in polygon.points) {
			polygon.points[key] = _editor.rotatePoint(polygon.points[key], angle, offset, centroid);
		}
		return polygon;
	}

	this.unrotateSegments = function (segmentation, segmentationSettings){
		let negativeOffset;
		let negativeCenter;
		let negativeOrientation;

		if(segmentationSettings != null) {
			negativeOrientation = -segmentationSettings.orientation;
			negativeOffset = -segmentationSettings.OffsetVector;
			negativeCenter = {};
			negativeCenter.x = segmentationSettings.center.x + segmentationSettings.OffsetVector.x;
			negativeCenter.y = segmentationSettings.center.y + segmentationSettings.OffsetVector.y;
		} else {
			negativeOrientation = -segmentation.orientation;
			negativeOffset = {};
			negativeOffset.x = -segmentation.OffsetVector.x;
			negativeOffset.y = -segmentation.OffsetVector.y;
			negativeCenter = {};
			negativeCenter.x = segmentation.center.x + segmentation.OffsetVector.x;
			negativeCenter.y = segmentation.center.y + segmentation.OffsetVector.y;
		}

		Object.keys(segmentation.segments).forEach((key) => {
			segmentation.segments[key].coords = this.rotatePolygon(negativeOrientation, segmentation.segments[key].coords, negativeOffset, negativeCenter);
		});
		return segmentation;
	}

	this.unrotateFixedGeometry = function (fixedGeometry, segmentationSettings){
		let negativeOffset;
		let negativeCenter;
		let negativeOrientation;

		if(segmentationSettings != null) {
			negativeOrientation = -segmentationSettings.orientation;
			negativeOffset = {};
			negativeOffset.x = -segmentationSettings.OffsetVector.x;
			negativeOffset.y = -segmentationSettings.OffsetVector.y;
			negativeCenter = {};
			negativeCenter.x = segmentationSettings.center.x + segmentationSettings.OffsetVector.x;
			negativeCenter.y = segmentationSettings.center.y + segmentationSettings.OffsetVector.y;
		}
		Object.keys(fixedGeometry.cuts).forEach((key) => {
			if(typeof(fixedGeometry.cuts[key]) !== undefined) {
				fixedGeometry.cuts[key].coords = this.rotatePolygon(negativeOrientation, fixedGeometry.cuts[key].coords, negativeOffset, negativeCenter);
			}
		});
		Object.keys(fixedGeometry.segments).forEach((key) => {
			if(!(typeof(fixedGeometry.segments[key]) === undefined || fixedGeometry.segments[key] == null)) {
				fixedGeometry.segments[key].coords = this.rotatePolygon(negativeOrientation, fixedGeometry.segments[key].coords, negativeOffset, negativeCenter);
			}
		});
		return fixedGeometry;
	}

	this.rotateAnnotations = function (result) {
		//rotate whole page
		this._orientation = result.orientation;
		_gui.updateOrientation(result.orientation);
		let dimensions = {};
		dimensions.x = result.width;
		dimensions.y = result.height;
		let offsetCenter = _editor.calculateRotOffset(this._orientation, dimensions);
		result.OffsetVector = offsetCenter.offsetVector;
		result.center = offsetCenter.trueCenter;
		Object.keys(result.segments).forEach((key) => {
			result.segments[key].coords = this.rotatePolygon(result.orientation,result.segments[key].coords,result.OffsetVector,result.center);
		});
		return result;
	}

	function isEmpty(obj) {
		for(let prop in obj) {
			if(obj.hasOwnProperty(prop)) {
				return false;
			}
		}
		return JSON.stringify(obj) === JSON.stringify({});
	}
}
