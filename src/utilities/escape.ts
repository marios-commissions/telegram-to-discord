function escape(content: string) {
	return content.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

export default escape;