const fetch = require('node-fetch');

const noElectionsError = require('../constants/errors/no-elections');
const invalidDataError = require('../constants/errors/invalid-data');

const controller = {};

controller.apiQueries = (req, res, next) => {
  const civicAPI = process.env.CIVIC_API_KEY;
  const mapsAPI = process.env.MAPS_API_KEY;

  // ***this is a sample address that will need to be replaced by user input from the front-end***
  // currently using an object so we have an object with their address, their longitude, and their latitude once everything is done.
  const userLocation = {};
  userLocation.address = '3549%20G%20Rd%20Palisade%20CO';

  // to geocode an address, we need to make a get request from this URL with the address
  // `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${mapsAPI}`
  // the resulting long/lat for each will be in results[index].geometry.location.lat and
  // results[index].geometry.location.long
  // in general, we'll want to use results[0] because other results are just if it's unsure
  // about the address and gives multiple responses

  // putting this in a function so we can return a promise that we wait for.
  // we'll want to wait for the promise for get ElectionData to resolve before calling this
  const geocodeUserAddress = () => {
    // get request for user address
    fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${userLocation.address}&key=${mapsAPI}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'Application/JSON',
      },
    })
      .then((response) => response.json())
      .then((data) => {
        console.log(`latitude is ${data.results[0].geometry.location.lat} and longitude is ${data.results[0].geometry.location.lng}`);
        userLocation.latitude = data.results[0].geometry.location.lat;
        userLocation.longitude = data.results[0].geometry.location.lng;
      })
      .catch();
  };

  // getting election ids
  const getElectionId = async () => {
    // placeholder for election id
    let electionId;
    return fetch(`https://www.googleapis.com/civicinfo/v2/elections?key=${civicAPI}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'Application/JSON',
      },
    })
      .then((response) => response.json())
      .then((data) => {
        // shorter reference to elections array. each element will be an object
        const { elections } = data;
        // save the last two characters from the address to get the state's shorthand, and convert to lowercase
        const stateCode = userLocation.address.substring(userLocation.address.length - 2).toLowerCase();
        // create an array to save elections that match the location
        const matchingElections = [];
        // iterate over the elections object
        for (let i = 0; i < elections.length; i += 1) {
          // look at the ocdDivisionId of each election to check for country-wide or state-specific elections
          // if it's country wide, we'll only get 'ocd-division/country:us'
          // if it's state-specific, we'll get 'ocd-division/country:us/state:[CODE]'
          // where [CODE] is the two letter shorthand for the state of the address passed in, in lowercase
          // for example 'co' for colorado, or 'wa' for washington
          if (elections[i].ocdDivisionId === 'ocd-division/country:us' || elections[i].ocdDivisionId.includes(`state:${stateCode}`)) {
            matchingElections.push(elections[i]);
          }
        }
        // if we get no matches, we have to let the user know there are no upcoming elections
        if (matchingElections.length === 0) {
          // and skip the next fetch because there is no election to get data about
          return noElectionsError(stateCode);
        }
        // if we only get one match, we can save the id immediately
        if (matchingElections.length === 1) {
          // if the id is 2000, then we have no real elections (2000 is sample data), so return an error
          if (parseInt(matchingElections[0].id, 10) === 2000) {
            return noElectionsError(stateCode);
          }
          // otherwise it's a valid election ID, so save it
          electionId = parseInt(data.elections[0].id, 10);
        }
        // if we get a match for more than one election, check electionDay for the earliest date
        if (matchingElections.length > 1) {
          // then sort the elections by date
          matchingElections.sort((a, b) => ((a.id > b.id) ? 1 : -1));
          // if the first election id is 2000, we need to skip it
          // we know we have at least one more, so...
          if (parseInt(matchingElections[0].id, 10) === 2000) {
            // grab the next id from the election object with the earliest date, and save it in electionId
            electionId = parseInt(matchingElections[1].id, 10);
          } else {
            // otherwise we can grab the first id from the election object with the earliest date, and save it in electionId
            electionId = parseInt(matchingElections[0].id, 10);
          }
        }
        return electionId;
      })
      .catch((err) => console.log(`ERROR in server attempting to get Election ids. Error is: ${err}`));
  };
  
  // getting info about the next election based on address passed in
  const getElectionData = async (electionId) => {
    // if it's defined, pass it to the API with the address and api key to get the matching election info
    // we also only accept the election info that is marked as "official" in the API using the "officialOnly=true"
    return fetch(`https://www.googleapis.com/civicinfo/v2/voterinfo?key=${process.env.CIVIC_API_KEY}&address=${userLocation.address}&electionId=${electionId}&officialOnly=true`, {
      method: 'GET',
      headers: {
        'Content-Type': 'Application/JSON',
      },
    })
      .then((response) => response.json())
      .then((data) => {
        // check to make sure we've got an object with an election property, and that the id matches the one we wanted
        if (parseInt(data.election.id, 10) === electionId) {
          // if so, save it in electionData
          return data;
        }
        // otherwise, return an error
        return invalidDataError(electionId);
      })
      .catch((err) => console.log(`ERROR in server attempting to get election info for ${userLocation.address}. Error is: ${err}`));
  };
  
  const doGeocodeFetch = async (queryURI) => {
    return fetch(queryURI, {
      method: 'GET',
      headers: {
        'Content-Type': 'Application/JSON',
      },
    })
      .then((response) => response.json())
      .then((data) => {
        // saving and exporting an object with the matching latitude and longitude from the API results
        const location = {};
        location.latitude = data.results[0].geometry.location.lat;
        location.longitude = data.results[0].geometry.location.lng;
        return location;
      })
      .catch((err) => {
        console.log('error getting pollingLocation address\'s latitude and/or longitude: ', err);
      });
  };

  const geocodeVotingLocations = async (electionData) => {
    // loop for pollingLocations array
    for (let i = 0; i < electionData.pollingLocations.length; i += 1) {
      // simpler reference to the location for the current element
      const location = electionData.pollingLocations[i].address;
      // appending together the first line of the address with the city and state
      let currentAddress = `${location.line1} ${location.city} ${location.state}`;
      // encoding the address so we can use it in the query URI
      currentAddress = encodeURI(currentAddress);
      // saving the query URI for our fetch request
      const queryURI = `https://maps.googleapis.com/maps/api/geocode/json?address=${currentAddress}&key=${mapsAPI}`;
      // then make call to geocoding API to get long/lat
      const loc = await doGeocodeFetch(queryURI);
      // grab the long and lat properties from the result of the API query
      const { longitude, latitude } = loc;
      // and save them in the address property for that pollingLocation
      location.longitude = longitude;
      location.latitude = latitude;
    }

    // loop for earlyVoteSites locations array
    for (let i = 0; i < electionData.earlyVoteSites.length; i += 1) {
      // simpler reference to the location for the current element
      const location = electionData.earlyVoteSites[i].address;
      // appending together the first line of the address with the city and state
      let currentAddress = `${location.line1} ${location.city} ${location.state}`;
      // encoding the address so we can use it in the query URI
      currentAddress = encodeURI(currentAddress);
      // saving the query URI for our fetch request
      const queryURI = `https://maps.googleapis.com/maps/api/geocode/json?address=${currentAddress}&key=${mapsAPI}`;
      // then make call to geocoding API to get long/lat
      const loc = await doGeocodeFetch(queryURI);
      // grab the long and lat properties from the result of the API query
      const { longitude, latitude } = loc;
      // and save them in the address property for that earlyVoteSite
      location.longitude = longitude;
      location.latitude = latitude;
    }

    // loop for dropOffLocations array
    for (let i = 0; i < electionData.dropOffLocations.length; i += 1) {
      // simpler reference to the location for the current element
      const location = electionData.dropOffLocations[i].address;
      // appending together the first line of the address with the city and state
      let currentAddress = `${location.line1} ${location.city} ${location.state}`;
      // encoding the address so we can use it in the query URI
      currentAddress = encodeURI(currentAddress);
      // saving the query URI for our fetch request
      const queryURI = `https://maps.googleapis.com/maps/api/geocode/json?address=${currentAddress}&key=${mapsAPI}`;
      // then make call to geocoding API to get long/lat
      const loc = await doGeocodeFetch(queryURI);
      // grab the long and lat properties from the result of the API query
      const { longitude, latitude } = loc;
      // and save them in the address property for that dropOffLocation
      location.longitude = longitude;
      location.latitude = latitude;
    }
    // return the election data with all the long/lat coordinates added
    return electionData;
  };

  const electionPipeline = async () => {
    // immediately geocode the user address
    // the result gets saved to the outer scope
    await geocodeUserAddress();
    // then get the matching election ids
    const electionId = await getElectionId();
    const electionData = await getElectionData(electionId);
    const finalResults = await geocodeVotingLocations(electionData);
    console.log(finalResults.pollingLocations[0].address);
  };

  // now we can use the variable 'electionData' to pick out what we want to send to the front end

  // invoking our election pipeline
  (async () => { await electionPipeline(); })();
};

module.exports = controller;