const [state , setState]  = useState({
   
    loading : false , 
    status: false , 
    error : false , 
});

useEffect (()=>{
    let cancelled = false ;

    async function fetchData(){
        setState({
            ...state ,
            loading : true , 
        })

        try{
            const response = await fetch('https://api.example.com/data');
            const data = await response.json() ;
            if(!cancelled){
                setState({
                    ...state ,
                    loading : false , 
                    status: true ,
                })
        }
    }
})


async function getstock(){
    const cached = `quote_${symbol}` ;
    try{ 
    const cacheddata = await redis.get(cached) ; 

    if(cacheddata){
        return JSON.parse(cacheddata) ;
    }

}
catch (err){
    logger.warn(`Error fetching cached data for ${symbol}: ${err.message}`);
    cached , 
    message : error.message 
}
}