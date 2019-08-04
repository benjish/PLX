(() => {
	"use strict";
	/*
		terser --keep-classnames -m --mangle-props regex=^_ -c -o plx.min.js -- plx.js
	*/

	/*function Debug_createLine(pos) {
		const elm = document.createElement('div');

		elm.style.position = 'absolute';
		elm.style.left = '0px';
		elm.style.right = '0px';
		elm.style.top = pos+'px';
		elm.style.height = '1px';
		elm.style.backgroundColor = 'red';
		elm.style.zIndex = 9999999;

		document.body.appendChild(elm);

		console.log('debug',elm);
	}*/


	let passiveEventSup = false;
	try {
		let options = Object.defineProperty({}, "passive", {
			get: () => {
				passiveEventSup = true;
			}
		});

		window.addEventListener("test", options, options);
		window.removeEventListener("test", options, options);
	} catch(err) {
		passiveEventSup = false;
	}

	const checkResponsive = (obj,offsets) => {
		if (obj.minWidth && obj.minWidth > offsets.viewportWidth) return false;
		if (obj.maxWidth && obj.maxWidth < offsets.viewportWidth) return false;
		if (obj.minHeight && obj.minHeight > offsets.viewportHeight) return false;
		if (obj.maxHeight && obj.maxHeight < offsets.viewportHeight) return false;

		return true;
	}

	class PLXEasing { }

	const EasingCB_vFn = (v1,v2) => {
		v1 *= 3; v2 *= 3;
		const a = v1 - v2 + 1, b = v2 - v1 * 2;
		//return t => a * Math.pow(t,3) + b * Math.pow(t,2) + v1 * t;
		return t => a * t*t*t + b * t*t + v1 * t;
	}

	const EasingCB_precision = 0.00001;
	const EasingCB_resolveT = (x,xFn) => {
		let left = 0, right = 1, t, approximateX;
		while (left < right) {
			t = (left + right) / 2;
			approximateX = xFn(t);
			if (Math.abs(x - approximateX) < EasingCB_precision) return t;
			else if (x < approximateX) right = t;
			else left = t;
		}

		return t;
	}

	PLXEasing.cubicBezier = (x1, y1, x2, y2) => {
		const yFn = EasingCB_vFn(y1,y2), xFn = EasingCB_vFn(x1,x2);
		return x => x <= 0 ? 0 : x >= 1 ? 1 : yFn(EasingCB_resolveT(x,xFn));
	}

	PLXEasing.linear    = x => x; //PLXEasing.cubicBezier(0, 0, 1, 1);
	PLXEasing.ease      = PLXEasing.cubicBezier(0.25, 0.1, 0.25, 1);
	PLXEasing.easeIn    = PLXEasing.cubicBezier(0.42, 0, 1, 1);
	PLXEasing.easeOut   = PLXEasing.cubicBezier(0, 0, 0.58, 1);
	PLXEasing.easeInOut = PLXEasing.cubicBezier(0.42, 0, 0.58, 1);

	PLXEasing.speCurve = (xstart,ystart,xend,yend,vmod) => {
		const realX = x => x - xstart,
		      realEndX = xend - xstart,
		      mod = x => 1 / Math.pow(x,vmod),
		      curve = x => mod(realX(x)) / Math.abs(mod(realEndX)),
		      straight = x => (ystart - yend) / realEndX * realX(x);

		return x => {
			if (x <= xstart) return ystart;
			if (x >= xend) return yend;

			return ystart - straight(x) * curve(x);
		};
	};

	class PLXAnchor {
		constructor(strAnchor) {
			this._anchor = PLXAnchor._parseAnchor(strAnchor);
		}

		_update(entryOffsets) {
			this._scrollY = entryOffsets.y - entryOffsets.viewportHeight *
				this._anchor._viewport + entryOffsets.h * this._anchor._element;
		}

		_getY() {
			return this._scrollY;
		}

		_getDirection() {
			return this._anchor._direction;
		}
	}

	PLXAnchor._str2value = (x,defaultV = 0) => {
		switch (x) {
			case 'top' : return 0;
			case 'bottom' : return 1;
			case 'center' : return .5;
			case 'up' : return -1;
			case 'down' : return 1;
			case 'both' : return 0;
			default:
				let v = Number.parseInt(x);
				if (isNaN(v)) return defaultV;

				return v / 100;
		}
	};

	PLXAnchor._parseAnchor = anchor => {
		anchor = anchor.trim().toLowerCase().replace(/-/g,',').replace(/,,/g,',-');
		if (anchor.startsWith(',')) anchor = '-' + anchor.substring(1);
		anchor = anchor.split(',');

		const len = anchor.length,
		hasDirection = ['up','down','both'].includes(anchor[len-1]);

		const _viewport = PLXAnchor._str2value(anchor[0]),
		      _element  = !hasDirection || len == 3 ?
		      	PLXAnchor._str2value(anchor[1],_viewport) : _viewport,
		      _direction = hasDirection ? PLXAnchor._str2value(anchor[len-1]) : 0;

		return {_viewport,_element,_direction};
	}

	class PLXAnimation {
		constructor(entry,anchorRun,anchorReset,fncAnimate,
				minWidth,maxWidth,minHeight,maxHeight) {
			this._entry = entry;
			this._anchorRun   = new PLXAnchor(anchorRun);
			this._anchorReset =
				typeof anchorReset != 'string' || anchorReset == 'none' ?
					null : new PLXAnchor(anchorReset);

			this._fncAnimate  = fncAnimate;

			this._runPos = 0;
			this._runDir = 0;
			this._resetPos = 0;
			this._resetDir = 0;

			this.minWidth = minWidth;
			this.maxWidth = maxWidth;
			this.minHeight = minHeight;
			this.maxHeight = maxHeight;

			this._isDone = false;
		}

		_update(entryOffsets) {
			this._anchorRun._update(entryOffsets);

			this._runPos = this._anchorRun._getY();
			this._runDir = this._anchorRun._getDirection();

			if (this._anchorReset) {
				this._anchorReset._update(entryOffsets);
				this._resetPos = this._anchorReset._getY();
				this._resetDir = this._anchorReset._getDirection();
			}
		}

		_animate(scrollY,lastScrollY) {
			if (this._isDone) {
				if (!this._anchorReset || !PLXAnimation._checkAnchor(
					scrollY,lastScrollY,this._resetPos,this._resetDir)) return;
				this._reset();
			} else {
				if (!PLXAnimation._checkAnchor(scrollY,lastScrollY,
					this._runPos,this._runDir)) return;
					this._run();
			}

		}

		_reset() {
			if (!this._isDone) return;

			this._isDone = false;
			this._fncAnimate(this._entry._elm,true,this._entry.options);
		}

		_run() {
			if (this._isDone) return;

			this._isDone = true;
			this._fncAnimate(this._entry._elm,false,this._entry.options);
		}
	}

	PLXAnimation._checkAnchor = (scrollY,lastScrollY,anchorPos,anchorDir) => {
		const min = Math.min(scrollY,lastScrollY),
		      max = Math.max(scrollY,lastScrollY);
		if (anchorPos < min || anchorPos > max) return false;

		const dir = scrollY - lastScrollY > 0 ? 1 : -1;
		if (anchorDir != 0 && anchorDir != dir) return false;

		return true;
	}

	PLXAnimation.cssAnimation = cssAnimationClassName => {
		return (elm,isReset) => {
			if (isReset) {
				elm.style.animationPlayState = '';
				elm.classList.remove(cssAnimationClassName);
				return;
			}

			if (elm.classList.contains(cssAnimationClassName)) {
				elm.classList.remove(cssAnimationClassName);
				void elm.offsetWidth;
			}

			elm.classList.add(cssAnimationClassName);
			elm.style.animationPlayState = 'running';
		};
	}

	class PLXInterpolation {
		constructor(entry,anchorStart,anchorEnd,fncInter,
				minWidth,maxWidth,minHeight,maxHeight) {
			this._entry = entry;
			this._anchorStart = new PLXAnchor(anchorStart);
			this._anchorEnd   = new PLXAnchor(anchorEnd);
			this._fncInter    = fncInter;
			this._lastInter   = -2;

			this.minWidth = minWidth;
			this.maxWidth = maxWidth;
			this.minHeight = minHeight;
			this.maxHeight = maxHeight;

			this._start = 0;
			this._end = 0;
			this._range = 0;
		}

		_update(entryOffsets) {
			this._anchorStart._update(entryOffsets);
			this._anchorEnd._update(entryOffsets);
			this._start = this._anchorStart._getY();
			this._end   = this._anchorEnd._getY();
			this._range = this._end - this._start;
		}

		_getFrame(scrollPos) {
			const f = (scrollPos - this._start) / this._range;
			return f < 0 ? 0 : f > 1 ? 1 : f;
		}

		_interpolate(scrollPos) {
			const frame = this._getFrame(scrollPos);
			if (frame == this._lastInter) return;
			this._lastInter = frame;
			this._fncInter(this._entry._elm,frame,this._entry.options);
		}
	}

	PLXInterpolation._parser_extractNumbers = prop => {
		const re = RegExp('-?\\d*\\.\\d+|!?-?\\d+|#[0-9a-fA-F]{3,8}','g'),
		      out = [];
		let v;
		while ((v = re.exec(prop)) !== null) out.push(v);

		return out;
	};

	PLXInterpolation._parser_valueColor = vstr => {
		vstr = vstr.substring(1);
		if (![3,4,6,8].includes(vstr.length))
			throw new Error('PLXInterpolation._parser_valueColor on : '+vstr);

		const spl = vstr.length <= 4 ?
			vstr.match(/.{1}/g).map(x => x.concat(x)) : vstr.match(/.{2}/g);

		return spl.map(x => parseInt(x, 16));
	};

	PLXInterpolation._parser_normalizeValueColor = (vstart,vend) => {
		for (let i = vend.length; vstart.length > vend.length; i++) {
			vend.push(vstart[i]);
		}

		 return vend;
	};

	PLXInterpolation._parser_valueType = (vstr,forcetype=-1) => {
		// 1 : INT ; 2 : HEX COLOR ; 0 : FLOAT
		const type = forcetype != -1 ? forcetype :
			vstr.startsWith('!') ? 1 : vstr.startsWith('#') ? 2 : 0;

		const value =
			type == 0 ? Number.parseFloat(vstr) :
			type == 1 ? Number.parseInt(vstr.substring(1)) :
			PLXInterpolation._parser_valueColor(vstr);

		return {type,value};
	};

	PLXInterpolation.propParser = prop => {
		if (typeof prop == 'function') return prop;

		prop = prop.map(x => typeof x == 'number' ? x.toString() : x);

		const s = PLXInterpolation._parser_extractNumbers(prop[0]);
		const e = PLXInterpolation._parser_extractNumbers(prop[1]);
		const p = prop[0];

		if (s.length != e.length)
			throw new Error('PLXInterpolation.propParser on : '+p);

		let i,ts,te,tp,li;
		const str = [];
		for (i = 0, li = 0; i < s.length; i++) {
			ts = s[i][0];
			te = e[i][0];

			str.push(p.substring(li,s[i].index));
			li = s[i].index + ts.length;

			if (ts === te) {
				if (ts.startsWith('!')) ts = ts.substring(1);
				str.push(ts);
			} else {
				ts = PLXInterpolation._parser_valueType(ts);
				te = PLXInterpolation._parser_valueType(te,ts.type);

				if (ts.type == 2) { // COLOR
					te.value = PLXInterpolation
						._parser_normalizeValueColor(ts.value,te.value);
				}

				str.push({type: ts.type, start: ts.value, end :te.value});
			}
		}

		if (p.length > li) str.push(p.substring(li));

		const out = [];
		for (i = 0; i < str.length; i++) {
			tp = str[i];

			if (i > 0 && typeof tp == 'string'
				&& typeof out[out.length - 1] == 'string'
			) {
				out[out.length - 1] = out[out.length - 1].concat(tp);
			} else {
				out.push(tp);
			}
		}

		return out;
	};

	PLXInterpolation.simpleAnimator = (props,options) => {
		if (typeof props != 'object') return null;

		options = typeof options == 'object' ? options : {};
		const selector = typeof options.selector === 'function' ?
				options.selector : null;
		const transition = options.transition || 0;

		const easing = typeof options.easing == 'function' ? options.easing :
			PLXEasing[ typeof options.easing == 'string'
				&& typeof PLXEasing[options.easing] == 'function' ?
				options.easing : 'linear'
			];

		const properties = [];
		for (const p in props) {
			const easingFunc = props[p].length > 2 ? (
					typeof props[p][2] == 'string' &&
					typeof PLXEasing[props[p][2]] == 'function' ?
						PLXEasing[props[p][2]] :
						typeof props[p][2] == 'function' ? props[p][2] : undefined
				) : undefined;

			properties.push({
				name : p,
				prop: PLXInterpolation.propParser(props[p]),
				easing : typeof props[p] == 'function' && props[p].easing ?
					props[p].easing : props[p].length > 2 ? props[p][2] : undefined
			});
		}

		const transtionProp = transition > 0 ? "all "+transition+"s linear" : null;


		return (elm,frame) => {
			const x = easing(frame),
			      c = selector ? selector(elm) : elm;
			let p;

			if (transtionProp) {
				c.style.transition = transtionProp;
			}

			for (let i = 0;i < properties.length; i++) {
				p = properties[i];
				if (typeof p.prop == 'function') {
					p.prop(c,p.easing ? p.easing(frame) : x,frame);
					continue;
				}

				c.style[p.name] = PLXInterpolation.
					interpolateProp(p.prop,p.easing ? p.easing(frame) : x);
			}

		}
	};

	PLXInterpolation.interpolateFloat = (start,end,frame) => {
		/*
		const v = Math.round((start + (end - start) * frame) * 1000000);
		if (v == 0) return v;
		return v / 1000000;
		*/

		return start + (end - start) * frame;
	};

	PLXInterpolation.interpolateInt = (start,end,frame) => {
		return Math.round(start + (end - start) * frame);
	};

	PLXInterpolation.interpolateColor = (start,end,frame) => {
		const slen = start.length;
		let v,out = '#';

		for (let i = 0;i < slen;i++) {
			v = PLXInterpolation.interpolateInt(start[i],end[i],frame).toString(16);
			if (v.length < 2) out += '0';
			out += v;
		}

		return out;
	};

	PLXInterpolation.interpolateProp = (prop,frame) => {
		let r = '', x;

		for (let i = 0; i < prop.length; i++) {
			x = prop[i];
			switch (x.type) {
				case 0 : //FLOAT
					r += PLXInterpolation.interpolateFloat(x.start,x.end,frame);
					break;
				case 1 : //INT
					r += PLXInterpolation.interpolateInt(x.start,x.end,frame);
					break;
				case 2 : //COLOR
					r += PLXInterpolation.interpolateColor(x.start,x.end,frame);
					break;
				default: //STRING
					r += x;
					break;
			}
		}

		return r;
	};

	class PLXParallax {
		constructor(elm,options) {
			//this._entry = entry;
			this._elm = elm;

			this._min = false;
			this._max = false;

			this.setOptions(options);
		}

		setOptions(options) {
			if (typeof options.speed == 'number')
				this._speed = options.speed;
			if (['number','function'].includes(typeof options.min))
				this._min = options.min;
			if (['number','function'].includes(typeof options.max))
				this._max = options.max;
			if (typeof options.zIndex == 'number') {
				this._zIndex = options.zIndex;
				this._elm.style.zIndex = this._zIndex;
			}

			this.minWidth = options.minWidth;
			this.maxWidth = options.maxWidth;
			this.minHeight = options.minHeight;
			this.maxHeight = options.maxHeight;

			switch (options.type) {
				case 'background' :
					this._perform = this._performBackground;
					break;
				case 'image' :
					this._perform = this._performImage;
					break;
				case 'element' :
				default:
					this._perform = this._performElement;
					break;
			}
		}

		_update(entryOffsets) {
			this._offsetTop = entryOffsets.y;
			this._offsetHeight = entryOffsets.h;
			this._viewportHeight = entryOffsets.viewportHeight;
			this._scrollRef = entryOffsets.y -
				(this._viewportHeight - entryOffsets.h) / 2;

			this._minV = typeof this._min == 'function' ?
				this._min(this._elm) : this._min;
			this._maxV = typeof this._max == 'function' ?
				this._max(this._elm) : this._max;
		}

		_getValue(scrollY) {
			let value = Math.round((scrollY - this._scrollRef) * this._speed);
			if (this._minV !== false && value < this._minV) value = this._minV;
			if (this._maxV !== false && value > this._maxV) value = this._maxV;

			return value;
		}

		_performImage(scrollY) {
			/*if (this.speed == 0) return;*/
			const value = this._getValue(scrollY);

			if (value == this._value) return;
			this._value = value;

			this._elm.style.objectPosition = '50% calc(50% + '+value+'px)';

			/*console.log('parralax',value,this.max);*/
		}

		_performElement(scrollY) {
			/*if (this.speed == 0) return;*/
			const value = this._getValue(scrollY);

			if (value == this._value) return;
			this._value = value;

			this._elm.style.transform = 'translate3d(0,'+value+'px,0)';

			/*console.log('parralax',value,this.max);*/
		}

		_performBackground(scrollY) {
			const value = this._getValue(scrollY);

			if (value == this._value) return;
			this._value = value;

			this._elm.style.backgroundPositionY = value+'px';
		}
	}

	class PLXEntry {
		constructor(elm,options = {}) {
			this._elm = elm;
			this.options = options;
		}

		_update() {
			this._elm.removeAttribute('style');

			const entryOffsets = this._getOffsets();


			this._firstAnchor = null;
			this._lastAnchor = null;


			this._realInterpolations = undefined;
			this._realAnimations = undefined;
			this._realParallax = undefined;

			if (!checkResponsive(this.options,entryOffsets)) {
				if (this._animations) for (i = 0; i < this._animations.length;i++) {
					this._animations[i]._reset();
				}
				return;
			}

			let min,max,i,x;

			if (this._interpolations) for (i = 0; i < this._interpolations.length;i++) {
				x = this._interpolations[i];

				if (!checkResponsive(x,entryOffsets)) continue;

				if (typeof this._realInterpolations == 'undefined')
					this._realInterpolations = [];

				this._realInterpolations.push(x);

				x._update(entryOffsets);
				min = Math.min(x._start,x._end);
				max = Math.max(x._start,x._end);

				if (this._firstAnchor == null || min < this._firstAnchor)
					this._firstAnchor = min;
				if (this._lastAnchor == null || max > this._lastAnchor)
					this._lastAnchor = max;
			}

			if (this._animations) for (i = 0; i < this._animations.length;i++) {
				x = this._animations[i];

				if (!checkResponsive(x,entryOffsets)) {
					x._reset();
					continue;
				}

				if (typeof this._realAnimations == 'undefined')
					this._realAnimations = [];

				this._realAnimations.push(x);

				x._update(entryOffsets);
				min = x._anchorReset ? Math.min(x._runPos,x._resetPos) : x._runPos;
				max = x._anchorReset ? Math.max(x._runPos,x._resetPos) : x._runPos;

				if (this._firstAnchor == null || min < this._firstAnchor)
					this._firstAnchor = min;
				if (this._lastAnchor == null || max > this._lastAnchor)
					this._lastAnchor = max;
			}

			if (this._parallaxes) for (i = 0; i < this._parallaxes.length;i++) {
				x = this._parallaxes[i];

				if (!checkResponsive(x,entryOffsets)) continue;

				x._update(entryOffsets);
				this._realParallax = x;
			}

			if (this._firstAnchor == null || this._lastAnchor == null) {
				this._firstAnchor = Infinity;
				this._lastAnchor = -Infinity;
			}
		}

		_isAlive() {
			return this._realInterpolations ||
				this._realAnimations ||
				this._realParallax;
		}

		_perform(scrollY,lastScrollY) {
			let i;

			if (this._realInterpolations) for (i = 0; i < this._realInterpolations.length;i++) {
				this._realInterpolations[i]._interpolate(scrollY);
			}

			if (this._realAnimations) for (i = 0; i < this._realAnimations.length;i++) {
				this._realAnimations[i]._animate(scrollY,lastScrollY);
			}
		}

		_performParallax(scrollY) {
			if (this._realParallax) this._realParallax._perform(scrollY);
		}

		_getOffsets() {
			let elm  = this._elm,
			    oTop = elm.offsetTop;
			//    oLeft = elm.offsetLeft;
			while (elm = elm.offsetParent) {
				oTop += elm.offsetTop;
				//oLeft += elm.offsetLeft;
			}

			return {
				//x : oLeft,
				y : oTop,
				//w : this._elm.offsetWidth,
				h : this._elm.offsetHeight,
				viewportHeight: document.documentElement.clientHeight,
				viewportWidth: document.documentElement.clientWidth,
			};
		}

		addInterpolation(anchorStart,anchorEnd,fncInter,
			minWidth,maxWidth,minHeight,maxHeight) {
			if (!this._interpolations) this._interpolations = [];

			this._interpolations.push(new PLXInterpolation(this,
				anchorStart,
				anchorEnd,
				fncInter,
				minWidth,maxWidth,minHeight,maxHeight
			));

			return this;
		}

		addCSSInterpolation(conf) {
			const options = {};
			if (conf.selector) options.selector = conf.selector;
			if (conf.transition) options.transition = conf.transition;
			if (conf.easing) options.easing = conf.easing;

			return this.addInterpolation(conf.start,conf.end,
				PLXInterpolation.simpleAnimator(conf.css,options),
				conf.minWidth,conf.maxWidth,conf.minHeight,conf.maxHeight);
		}

		addAnimation(anchorRun,anchorReset,fncAnimate,
			minWidth,maxWidth,minHeight,maxHeight) {
			if (!this._animations) this._animations = [];

			this._animations.push(new PLXAnimation(this,
				anchorRun,
				anchorReset,
				fncAnimate,
				minWidth,maxWidth,minHeight,maxHeight
			));

			return this;
		}

		addCSSAnimation(conf) {
			return this.addAnimation(conf.run,conf.reset,
				PLXAnimation.cssAnimation(conf.className),
				conf.minWidth,conf.maxWidth,conf.minHeight,conf.maxHeight);
		}

		addParallax(options) {
			if (!this._parallaxes) this._parallaxes = [];
			this._parallaxes.push(new PLXParallax(this._elm,options));
			return this;
		}
	}

	class PLXScroller {
		constructor() {
			this._wheelEvent  = this._wheelEvent.bind(this);
			this._scrollFrame = this._scrollFrame.bind(this);
		}

		init(frameRequester) {
			this._direction = 0,
			this._startTime = 0,
			this._startPos = 0,
			this._targetPos = 0,
			this._speed = 0,
			this._countScrollEqual = 0,
			this._lastFrameTime = 0;
			this._wheelCount = 0,
			this._frameRequest = false,
			this._wheelRequest = false;
			this._cssScrollBehavior = '';

			this._frameRequester = frameRequester;

			document.body.addEventListener('wheel',this._wheelEvent,
				passiveEventSup ? { passive: false,capture: false } : false);
		}

		destroy() {
			document.body.removeEventListener('wheel',this._wheelEvent,
				passiveEventSup ? { passive: false,capture: false } : false);
		}

		_wheelEvent(e) {
			e.stopImmediatePropagation();
			if (e.target != document.body
				&& PLXScroller._hasScrollBar(e.target)) {
				console.log("ELEMENT WITH SCROLLBAR",e.target);
				return;
			}

			e.preventDefault();

			const ndir = e.deltaY > 0 ? 1 : -1;

			if (this._direction == 0) {
				this._direction  = ndir;
				this._wheelCount = 1;
				this._start();
			} else if (ndir == this._direction) {
				this._wheelCount++;
			} else return this._stop();

			this._wheelRequest = true;
		}

		_start() {
			if (!this._frameRequest) {
				this._cssScrollBehavior = document.body.style.scrollBehavior;
				document.body.style.scrollBehavior = 'auto';
				this._frameRequest = true;
				this._frameRequester();
			}
		}

		_stop() {
			//console.log('FRAME','STOP',this._targetPos,window.scrollY);
			this._frameRequest = false;
			this._direction = 0;
			this._startTime = 0;
			document.body.style.scrollBehavior = this._cssScrollBehavior;
		}

		_scrollFrame(now,scrollY,lastScrollY) {
			if (!this._frameRequest) return scrollY;

			if (this._startTime == 0) {
				this._startTime = this._lastFrameTime = now;
				this._startPos = scrollY;
				this._speed = 0;
				this._countScrollEqual = 0;
			}

			if (this._wheelRequest) {
				this._wheelRequest = false;

				this._targetPos = this._startPos + Math.round(PLXScroller.stepBase * this._wheelCount * this._direction);
			}

			const distance = Math.abs(this._targetPos - scrollY);
			if (distance == 0) {
				this._stop();
				return scrollY;
			}

			const frameGap = now - this._lastFrameTime;
			this._lastFrameTime = now;

			this._speed = PLXScroller._speedRegulator(distance,this._speed);

			let newPos = scrollY + Math.ceil(frameGap * (this._speed / 1000)) * this._direction;

			if (this._direction < 0 && newPos < this._targetPos) newPos = this._targetPos;
			else if (this._direction > 0 && newPos > this._targetPos) newPos = this._targetPos;

			this._countScrollEqual = lastScrollY == scrollY ? this._countScrollEqual+1 : 0;

			if (frameGap > 0 && (this._countScrollEqual >= 5 || scrollY == this._targetPos)) {
				this._stop();
				return scrollY;
			}

			window.scrollTo(0,newPos);

			return newPos;
		}
	}

	PLXScroller.stepBase = 200; //document.documentElement.clientHeight / 5;
	PLXScroller.minSpeedDistance = 0; // px
	PLXScroller.maxSpeedDistance = 2000; // px
	PLXScroller.minSpeed = 0; // px/s
	PLXScroller.maxSpeed = 4000; // px / s
	PLXScroller.speedCoefMax = 1.5;
	PLXScroller.speedCoefMin = 1.1;

	PLXScroller.speedCurve = PLXEasing.cubicBezier(0,.38,1,.64);

	PLXScroller._speedRegulator = (distance,speed) => {
		const speedTarget = PLXScroller.minSpeed + (PLXScroller.maxSpeed - PLXScroller.minSpeed)
			* PLXScroller.speedCurve(
				(distance - PLXScroller.minSpeedDistance) / PLXScroller.maxSpeedDistance
			);

		if (speed >= speedTarget || speed == 0) return speedTarget;

		speed *= PLXScroller.speedCoefMin + (PLXScroller.speedCoefMax - PLXScroller.speedCoefMin) * (1 - 1/speedTarget * speed);

		/* -- DEBUG --
		const coef = PLXScroller.speedCoefMin + (PLXScroller.speedCoefMax - PLXScroller.speedCoefMin) * (1 - 1/speedTarget * speed);
		if (speed < speedTarget) console.log('sp',speed ,'spt', speedTarget,coef);
		else  console.log('------ > sp',speed ,'spt', speedTarget,coef);
		//*/

		return speed > speedTarget ? speedTarget : speed;
	}

	PLXScroller._hasScrollBar = (() => {
		return typeof document.documentElement.scrollTopMax == 'number' ?
			elm => elm.scrollTopMax > 0 : elm => {
				if (elm.scrollHeight <= elm.offsetHeight) return false;

				if (typeof elm._PLX_overflowY == 'undefined') {
					elm._PLX_overflowY = !['visible','hidden']
						.includes(window.getComputedStyle(elm).overflowY);
				}

				return elm._PLX_overflowY;
			}
	})();

	class PLX {
		constructor(options = {}) {
			this._entries = [];
			this._lastScrollY = -1;
			this._destroyed = false;
			this._requestFrame = this._requestFrame.bind(this);
			this._startFrames = this._startFrames.bind(this);

			this._requestFrameLoop = false;
			this._requestFrameRun = false;
			this._requestFrameTime = 0;
			this.options = options;

			if (typeof this.options.scroller != 'boolean')
				this.options.scroller = true;
		}

		destroy() {
			this._entries.clear();

			if (this._scroller) {
				this._scroller.destroy();
				this._scroller = null;
			}

			window.removeEventListener('resize', this._resizeEvent,
				passiveEventSup ? { passive: true,capture: false } : false);
			window.removeEventListener('scroll', this._scrollEvent,
				passiveEventSup ? { passive: true,capture: false } : false);
			this.destroyed = true;
		}

		run() {
			this._resizeEvent = () => {
				clearTimeout(this._doResize);
				this._doResize = setTimeout(() => this._buildTriggers(),200);
			}

			this._scrollEvent = (e) => {
				//PLX.SCROLL_Y = e.pageY || window.scrollY;

				this._startFrames();
			}

			window.addEventListener('resize',this._resizeEvent,
				passiveEventSup ? { passive: true,capture: false } : false);
			window.addEventListener('scroll',this._scrollEvent,
				passiveEventSup ? { passive: true,capture: false } : false);

			this._buildTriggers();

			if (this.options.scroller) {
				this._scroller = new PLXScroller();

				this._scroller.init(this._startFrames);
			}
		}

		_startFrames() {

			if (this._requestFrameLoop) return;
			this._requestFrameLoop = true;

			if (!this._requestFrameRun) {
				window.removeEventListener('scroll', this._scrollEvent,
					passiveEventSup ? { passive: true,capture: false } : false);

				window.requestAnimationFrame(this._requestFrame);
			}
		}

		_requestFrame(now) {
			if (this._requestFrameLoop) {
				this._requestFrameLoop = false;
				this._requestFrameTime = now;
				this._requestFrameRun = true;
			}

			let scrollY = window.scrollY;//PLX.SCROLL_Y || window.scrollY;
			const lastScrollY = this._lastScrollY;
			this._lastScrollY = scrollY;

			if (this._scroller && this._scroller._frameRequest)
				scrollY = this._scroller._scrollFrame(now,scrollY,lastScrollY);

			if (this._isEntriesAlive && lastScrollY != scrollY) {
				this._performFrame(scrollY,lastScrollY);
			}


			if ((!this._isEntriesAlive || now - this._requestFrameTime > 500)
			    && (!this._scroller || !this._scroller._frameRequest)) {
				this._requestFrameRun = false;

				window.addEventListener('scroll',this._scrollEvent,
				passiveEventSup ? { passive: true,capture: false } : false);
				return;
			}

			window.requestAnimationFrame(this._requestFrame);
		}

		_performFrame(scrollY,lastScrollY) {
			let mins = Math.min(scrollY,lastScrollY);
			let maxs = Math.max(scrollY,lastScrollY);

			let entry;
			for (let i = 0; i < this._realEntries.length; i++) {
				entry = this._realEntries[i];
				entry._performParallax(scrollY);

				if (entry._lastAnchor < mins
					&& entry._firstAnchor > maxs) continue;

				entry._perform(scrollY,lastScrollY)
			}
		}

		_buildTriggers() {
			this._realEntries = [];
			for (let i = 0; i < this._entries.length; i++) {
				const entry = this._entries[i];
				entry._update();
				if (entry._isAlive()) this._realEntries.push(entry);
			}

			this._isEntriesAlive = this._realEntries.length > 0;
			this._lastScrollY = -1;

			this._performFrame(window.scrollY,this._lastScrollY);
		}

		addEntry(entry) {
			if (entry.constructor.name != 'PLXEntry') {
				return console.error('PLX.addEntry must be an instance of PLXEntry');
			}

			if (!entry._elm) {
				return console.error('PLX.Entry Element not found');
			}
			this._entries.push(entry);

			return this;
		}
	}

	PLX.Entry         = PLXEntry;
	PLX.Interpolation = PLXInterpolation;
	PLX.Animation     = PLXAnimation;
	PLX.Parallax      = PLXParallax;
	PLX.Easing        = PLXEasing;
	PLX.Anchor        = PLXAnchor;
	PLX.Scroller      = PLXScroller;

	window.PLX = PLX;
})();
