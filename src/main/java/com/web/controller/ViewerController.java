package com.web.controller;

import java.io.File;
import java.io.IOException;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import javax.servlet.ServletContext;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Scope;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

import com.web.communication.BasicResponse;
import com.web.communication.ContourCombineRequest;
import com.web.communication.MergeRequest;
import com.web.communication.SegmentationRequest;
import com.web.config.FileConfiguration;
import com.web.facade.LarexFacade;
import com.web.model.Book;
import com.web.model.BookSettings;
import com.web.model.PageSegmentation;
import com.web.model.Point;
import com.web.model.Polygon;
import com.web.model.database.FileDatabase;
import com.web.model.database.IDatabase;

import larex.geometry.regions.type.RegionType;
import larex.segmentation.parameters.ImageSegType;

/**
 * Communication Controller to handle requests for the main viewer/editor.
 * Handles requests about displaying book scans and segmentations.
 * 
 */
@Controller
@Scope("request")
public class ViewerController {
	@Autowired
	private ServletContext servletContext;
	@Autowired
	private FileManager fileManager;
	@Autowired
	private FileConfiguration config;

	@RequestMapping(value = "/viewer", method = RequestMethod.GET)
	public String viewer(Model model, @RequestParam(value = "book", required = false) Integer bookID)
			throws IOException {
		init();
		if (bookID == null) {
			return "redirect:/404";
		}

		init();
		IDatabase database = new FileDatabase(new File(fileManager.getLocalBooksPath()),
				config.getListSetting("imagefilter"));
		Book book = database.getBook(bookID);

		if (book == null) {
			return "redirect:/404";
		}

		model.addAttribute("book", book);
		model.addAttribute("regionTypes", getregionTypes());
		model.addAttribute("imageSegTypes", getImageregionTypes());
		model.addAttribute("bookPath", fileManager.getURLBooksPath());
		model.addAttribute("globalSettings", config);

		return "editor";
	}

	@RequestMapping(value = "/direct", method = RequestMethod.POST)
	public String direct(Model model, @RequestParam(value = "bookpath", required = true) String bookpath,
			@RequestParam(value = "bookname", required = true) String bookname,
			@RequestParam(value = "localsave", required = false) String localsave,
			@RequestParam(value = "savedir", required = false) String savedir,
			@RequestParam(value = "websave", required = false) String websave,
			@RequestParam(value = "imagefilter", required = false) String imagefilter) throws IOException {
		init();
		if (!config.getSetting("directrequest").equals("enable")) {
			return "redirect:/403";
		}
		if (!new File(bookpath + File.separator + bookname).exists()) {
			return "redirect:/400";
		}
		fileManager.setLocalBooksPath(bookpath);
		int bookID = bookname.hashCode();

		if (localsave != null) {
			config.setSetting("localsave", localsave);
		}
		if (savedir != null) {
			config.setSetting("savedir", savedir);
		}
		if (websave != null) {
			config.setSetting("websave", websave);
		}
		if (imagefilter != null) {
			config.setSetting("imagefilter", imagefilter);
		}
		return viewer(model, bookID);
	}

	@RequestMapping(value = "/book", method = RequestMethod.POST)
	public @ResponseBody BasicResponse getBook(@RequestParam("bookid") int bookID,
			@RequestParam("pageid") int pageID) {
		init();
		IDatabase database = new FileDatabase(new File(fileManager.getLocalBooksPath()),
				config.getListSetting("imagefilter"));
		Book book = database.getBook(bookID);
		BookSettings settings = LarexFacade.getDefaultSettings(book);

		BasicResponse bookview = new BasicResponse(book, settings);
		return bookview;
	}

	@RequestMapping(value = "/segment", method = RequestMethod.POST, headers = "Accept=*/*", produces = "application/json", consumes = "application/json")
	public @ResponseBody PageSegmentation segment(@RequestBody SegmentationRequest segmentationRequest) {
		init();
		IDatabase database = new FileDatabase(new File(fileManager.getLocalBooksPath()),
				config.getListSetting("imagefilter"));
		return LarexFacade.segmentPage(segmentationRequest.getSettings(), segmentationRequest.getPages(),
				segmentationRequest.isAllowToLoadLocal(), fileManager, database);
	}

	@RequestMapping(value = "/emptysegment", method = RequestMethod.POST, headers = "Accept=*/*", produces = "application/json", consumes = "application/json")
	public @ResponseBody PageSegmentation emptysegment(@RequestBody SegmentationRequest segmentationRequest) {
		init();
		IDatabase database = new FileDatabase(new File(fileManager.getLocalBooksPath()),
				config.getListSetting("imagefilter"));
		return LarexFacade.emptySegmentPage(segmentationRequest.getSettings(), segmentationRequest.getPages(), database);
	}

	@RequestMapping(value = "/merge", method = RequestMethod.POST, headers = "Accept=*/*", produces = "application/json", consumes = "application/json")
	public @ResponseBody Polygon merge(@RequestBody MergeRequest mergeRequest) {
		IDatabase database = new FileDatabase(new File(fileManager.getLocalBooksPath()),
				config.getListSetting("imagefilter"));
		return LarexFacade.merge(mergeRequest.getSegments(), mergeRequest.getPage(), mergeRequest.getBookid(),
				fileManager, database);
	}

	@RequestMapping(value = "/combinecontours", method = RequestMethod.POST, headers = "Accept=*/*", produces = "application/json", consumes = "application/json")
	public @ResponseBody Polygon combinecontours(@RequestBody ContourCombineRequest combineRequest) {
		if(combineRequest.getContours().size() > 0) {
			IDatabase database = new FileDatabase(new File(fileManager.getLocalBooksPath()),
				config.getListSetting("imagefilter"));
			return LarexFacade.combineContours(combineRequest.getContours(), combineRequest.getPage(),
					combineRequest.getBookid(),combineRequest.getAccuracy(), fileManager, database);
		} else
			return null;
	}
	
	@RequestMapping(value = "/extractcontours", method = RequestMethod.POST)
	public @ResponseBody Collection<List<Point>> extractcontours(@RequestParam("bookid") int bookID,
			@RequestParam("pageid") int pageID) {

		IDatabase database = new FileDatabase(new File(fileManager.getLocalBooksPath()),
				config.getListSetting("imagefilter"));
		return LarexFacade.extractContours(pageID, bookID, fileManager, database);
	}

	@RequestMapping(value = "/segmentedpages", method = RequestMethod.POST)
	public @ResponseBody Collection<Integer> getOnServer(@RequestParam("bookid") int bookID) {
		init();
		FileDatabase database = new FileDatabase(new File(fileManager.getLocalBooksPath()),
				config.getListSetting("imagefilter"));
		return database.getSegmentedPageIDs(bookID);
	}
	
	private Map<RegionType, Integer> getregionTypes() {
		Map<RegionType, Integer> regionTypes = new HashMap<RegionType, Integer>();

		int i = 0;
		for (RegionType type : RegionType.values()) {
			regionTypes.put(type, i);
			i++;
		}
		return regionTypes;
	}

	private Map<ImageSegType, String> getImageregionTypes() {
		Map<ImageSegType, String> regionTypes = new TreeMap<ImageSegType, String>();
		regionTypes.put(ImageSegType.NONE, "None");
		regionTypes.put(ImageSegType.CONTOUR_ONLY, "Contour only");
		regionTypes.put(ImageSegType.STRAIGHT_RECT, "Straight rectangle");
		regionTypes.put(ImageSegType.ROTATED_RECT, "Rotated rectangle");
		return regionTypes;
	}

	private void init() {
		if (!fileManager.isInit()) {
			fileManager.init(servletContext);
		}
		if (!config.isInitiated()) {
			config.read(new File(fileManager.getConfigurationFile()));
			String bookFolder = config.getSetting("bookpath");
			if (!bookFolder.equals("")) {
				fileManager.setLocalBooksPath(bookFolder);
			}
		}
	}
}
